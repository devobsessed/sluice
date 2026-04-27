import { auth } from '@/lib/auth'
import { toNextJsHandler } from 'better-auth/next-js'

const handlers = toNextJsHandler(auth)

export const { GET } = handlers

const TOKEN_ENDPOINT_PATH = '/api/auth/oauth2/token'

/**
 * Wrap better-auth's POST handler to rewrite a single misclassified OAuth
 * error: `@better-auth/oauth-provider@1.4.19` returns
 * `{error: "invalid_request", error_description: "session not found"}` when a
 * client presents an unknown / expired / revoked refresh token. Per RFC 6749
 * §5.2 that case is `invalid_grant`. The wrong error code prevents OAuth-2.1
 * clients (e.g. `mcp-remote`) from invoking their stale-credential recovery
 * path, leaving users stuck without a re-auth prompt.
 *
 * The remap is scoped to the exact misclassified case:
 *  - URL path is the token endpoint
 *  - Method is POST with `grant_type=refresh_token`
 *  - Response is HTTP 400 with JSON `error === "invalid_request"`
 * Everything else passes through untouched so genuine `invalid_request`
 * surfaces (malformed body, missing params, etc.) remain diagnosable.
 */
export async function POST(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const isTokenEndpoint = url.pathname === TOKEN_ENDPOINT_PATH

  let isRefreshTokenGrant = false
  if (isTokenEndpoint) {
    try {
      const form = await request.clone().formData()
      isRefreshTokenGrant = form.get('grant_type') === 'refresh_token'
    } catch {
      // Body wasn't form-encoded - leave isRefreshTokenGrant false and pass through.
    }
  }

  const response = await handlers.POST(request)

  if (!isRefreshTokenGrant || response.status !== 400) {
    return response
  }

  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    return response
  }

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
