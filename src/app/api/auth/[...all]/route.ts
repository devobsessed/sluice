import { auth } from '@/lib/auth'
import { hashRefreshToken, dedupeRefreshRequest } from '@/lib/auth/refresh-dedupe'
import { toNextJsHandler } from 'better-auth/next-js'

const handlers = toNextJsHandler(auth)

export const { GET } = handlers

const TOKEN_ENDPOINT_PATH = '/api/auth/oauth2/token'

/**
 * Apply the PR #14 invalid_request -> invalid_grant remap to a response.
 * Pure function - takes a Response, returns a Response. Used inside
 * forwardWithRemap so the cached response is post-remap (racing duplicates
 * see the corrected error code, not the raw better-auth error).
 *
 * Remap is scoped to the exact misclassified case:
 *  - Response is HTTP 400 with JSON content-type
 *  - Body has `error === "invalid_request"`
 * Everything else passes through untouched.
 */
async function applyInvalidGrantRemap(response: Response): Promise<Response> {
  if (response.status !== 400) return response

  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) return response

  const cloned = response.clone()
  let body: unknown
  try {
    body = await cloned.json()
  } catch {
    return response
  }

  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    (body as { error?: unknown }).error !== 'invalid_request'
  ) {
    return response
  }

  const original = body as { error: string; error_description?: string; error_uri?: string }
  console.warn(
    'OAuth token endpoint: remapping invalid_request → invalid_grant for refresh_token grant',
    { error_description: original.error_description },
  )

  const remapped = { ...original, error: 'invalid_grant' }
  const headers = new Headers(response.headers)
  headers.delete('content-length')

  return new Response(JSON.stringify(remapped), {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

/**
 * Wrap better-auth's POST handler to:
 *
 * 1. Dedupe concurrent refresh-token requests (pre-handler).
 *    When two requests arrive with the same refresh_token within the cache
 *    window (~5s), better-auth is only called once. The second request gets
 *    the cached response. This prevents better-auth's reuse-detection branch
 *    from calling adapter.deleteMany() and nuking the user's entire refresh
 *    token chain.
 *
 * 2. Rewrite the misclassified OAuth error `invalid_request` -> `invalid_grant`
 *    (PR #14 remap). The remap runs INSIDE forwardWithRemap so the cached
 *    response is post-remap - racing duplicates see `invalid_grant`, not the
 *    raw better-auth `invalid_request`.
 *
 * Critical ordering:
 *  - Dedupe runs FIRST (pre-handler).
 *  - Remap applies to the forwarded response BEFORE it is cached.
 *  - Non-refresh-token paths skip dedupe entirely and behave as before.
 *  - Fail-open: if dedupe errors, it falls through to handlers.POST directly.
 */
export async function POST(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const normalizedPath = url.pathname.replace(/\/$/, '')
  const isTokenEndpoint = normalizedPath === TOKEN_ENDPOINT_PATH

  let isRefreshTokenGrant = false
  let refreshTokenValue: string | null = null
  if (isTokenEndpoint) {
    try {
      const form = await request.clone().formData()
      isRefreshTokenGrant = form.get('grant_type') === 'refresh_token'
      if (isRefreshTokenGrant) {
        const raw = form.get('refresh_token')
        refreshTokenValue = typeof raw === 'string' && raw.length > 0 ? raw : null
      }
    } catch {
      // Body wasn't form-encoded - leave both false/null and pass through.
    }
  }

  // Build the "forward to better-auth and apply remap" function once.
  // This is what dedupe wraps for refresh-token grants. The remap runs here
  // so the cached response is already post-remap when dedupe stores it.
  const forwardWithRemap = async (): Promise<Response> => {
    const response = await handlers.POST(request)
    if (!isRefreshTokenGrant) return response
    return applyInvalidGrantRemap(response)
  }

  // Dedupe applies only when:
  //  - this is the token endpoint
  //  - grant_type is refresh_token
  //  - we successfully extracted a non-empty refresh_token value
  if (isRefreshTokenGrant && refreshTokenValue) {
    const tokenHash = hashRefreshToken(refreshTokenValue)
    return dedupeRefreshRequest(tokenHash, forwardWithRemap)
  }

  // All other paths: forward + (conditionally) remap.
  return forwardWithRemap()
}
