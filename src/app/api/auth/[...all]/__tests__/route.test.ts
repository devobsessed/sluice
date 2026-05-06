import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  db: {},
}))

const mockBetterAuthGet = vi.fn()
const mockBetterAuthPost = vi.fn()

vi.mock('@/lib/auth', () => ({
  auth: {},
}))

vi.mock('better-auth/next-js', () => ({
  toNextJsHandler: () => ({
    GET: (req: Request) => mockBetterAuthGet(req),
    POST: (req: Request) => mockBetterAuthPost(req),
  }),
}))

// Mock the dedupe helper so existing unit tests stay isolated.
// Default: pass-through (calls forward directly, no DB required).
const mockDedupeRefreshRequest = vi.fn(
  async (_tokenHash: string, forward: () => Promise<Response>) => forward(),
)
const mockHashRefreshToken = vi.fn((token: string) => `hash(${token})`)

vi.mock('@/lib/auth/refresh-dedupe', () => ({
  hashRefreshToken: (token: string) => mockHashRefreshToken(token),
  dedupeRefreshRequest: (tokenHash: string, forward: () => Promise<Response>) =>
    mockDedupeRefreshRequest(tokenHash, forward),
}))

const routeModule = await import('../route')

const TOKEN_URL = 'http://localhost/api/auth/oauth2/token'

function buildTokenRequest(body: Record<string, string>): Request {
  return new Request(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  })
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

describe('OAuth route handler', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    // Restore default pass-through behaviour after any per-test overrides.
    mockDedupeRefreshRequest.mockImplementation(
      async (_tokenHash: string, forward: () => Promise<Response>) => forward(),
    )
    mockHashRefreshToken.mockImplementation((token: string) => `hash(${token})`)
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('exports GET and POST handlers', () => {
    expect(typeof routeModule.GET).toBe('function')
    expect(typeof routeModule.POST).toBe('function')
  })

  describe('refresh_token grant remap', () => {
    it('rewrites invalid_request → invalid_grant on 400 token responses', async () => {
      mockBetterAuthPost.mockResolvedValue(
        jsonResponse(400, { error: 'invalid_request', error_description: 'session not found' }),
      )

      const res = await routeModule.POST(
        buildTokenRequest({ grant_type: 'refresh_token', refresh_token: 'bogus', client_id: 'c1' }),
      )

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body).toEqual({ error: 'invalid_grant', error_description: 'session not found' })
      expect(warnSpy).toHaveBeenCalledOnce()
    })

    it('preserves additional fields like error_uri verbatim', async () => {
      mockBetterAuthPost.mockResolvedValue(
        jsonResponse(400, {
          error: 'invalid_request',
          error_description: 'session not found',
          error_uri: 'https://example.com/docs',
        }),
      )

      const res = await routeModule.POST(
        buildTokenRequest({ grant_type: 'refresh_token', refresh_token: 'bogus' }),
      )

      const body = await res.json()
      expect(body).toEqual({
        error: 'invalid_grant',
        error_description: 'session not found',
        error_uri: 'https://example.com/docs',
      })
    })

    it('tolerates a trailing slash on the token endpoint path', async () => {
      mockBetterAuthPost.mockResolvedValue(
        jsonResponse(400, { error: 'invalid_request', error_description: 'session not found' }),
      )

      const req = new Request(`${TOKEN_URL}/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: 'bogus' }).toString(),
      })
      const res = await routeModule.POST(req)

      const body = await res.json()
      expect(body.error).toBe('invalid_grant')
      expect(warnSpy).toHaveBeenCalledOnce()
    })

    it('preserves response headers (other than content-length)', async () => {
      mockBetterAuthPost.mockResolvedValue(
        jsonResponse(
          400,
          { error: 'invalid_request', error_description: 'session not found' },
          { 'X-Trace-Id': 'abc-123' },
        ),
      )

      const res = await routeModule.POST(
        buildTokenRequest({ grant_type: 'refresh_token', refresh_token: 'bogus' }),
      )

      expect(res.headers.get('X-Trace-Id')).toBe('abc-123')
      expect(res.headers.get('content-type')).toContain('application/json')
    })
  })

  describe('passthrough cases', () => {
    it('does not remap when grant_type is authorization_code', async () => {
      const upstream = jsonResponse(400, {
        error: 'invalid_request',
        error_description: 'missing code_verifier',
      })
      mockBetterAuthPost.mockResolvedValue(upstream)

      const res = await routeModule.POST(
        buildTokenRequest({ grant_type: 'authorization_code', code: 'xyz' }),
      )

      const body = await res.json()
      expect(body.error).toBe('invalid_request')
      expect(warnSpy).not.toHaveBeenCalled()
    })

    it('does not remap when grant_type is missing', async () => {
      mockBetterAuthPost.mockResolvedValue(
        jsonResponse(400, { error: 'invalid_request', error_description: 'missing grant_type' }),
      )

      const res = await routeModule.POST(
        buildTokenRequest({ refresh_token: 'bogus' }),
      )

      const body = await res.json()
      expect(body.error).toBe('invalid_request')
    })

    it('does not remap on non-token paths', async () => {
      mockBetterAuthPost.mockResolvedValue(
        jsonResponse(400, { error: 'invalid_request', error_description: 'unrelated' }),
      )

      const req = new Request('http://localhost/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token' }).toString(),
      })
      const res = await routeModule.POST(req)

      const body = await res.json()
      expect(body.error).toBe('invalid_request')
    })

    it('does not remap on non-400 responses', async () => {
      mockBetterAuthPost.mockResolvedValue(
        jsonResponse(200, { access_token: 'new-token', token_type: 'Bearer' }),
      )

      const res = await routeModule.POST(
        buildTokenRequest({ grant_type: 'refresh_token', refresh_token: 'good' }),
      )

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.access_token).toBe('new-token')
    })

    it('does not double-remap when error is already invalid_grant', async () => {
      mockBetterAuthPost.mockResolvedValue(
        jsonResponse(400, { error: 'invalid_grant', error_description: 'token revoked' }),
      )

      const res = await routeModule.POST(
        buildTokenRequest({ grant_type: 'refresh_token', refresh_token: 'bogus' }),
      )

      const body = await res.json()
      expect(body.error).toBe('invalid_grant')
      expect(body.error_description).toBe('token revoked')
      expect(warnSpy).not.toHaveBeenCalled()
    })

    it('does not remap when request body is JSON-encoded (not form-encoded)', async () => {
      mockBetterAuthPost.mockResolvedValue(
        jsonResponse(400, { error: 'invalid_request', error_description: 'session not found' }),
      )

      const req = new Request(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: 'bogus' }),
      })
      const res = await routeModule.POST(req)

      const body = await res.json()
      expect(body.error).toBe('invalid_request')
      expect(warnSpy).not.toHaveBeenCalled()
    })

    it('does not remap when content-type is not JSON', async () => {
      mockBetterAuthPost.mockResolvedValue(
        new Response('plain text error', {
          status: 400,
          headers: { 'Content-Type': 'text/plain' },
        }),
      )

      const res = await routeModule.POST(
        buildTokenRequest({ grant_type: 'refresh_token', refresh_token: 'bogus' }),
      )

      expect(res.status).toBe(400)
      expect(await res.text()).toBe('plain text error')
    })
  })

  describe('dedupe wiring', () => {
    it('calls dedupeRefreshRequest with hashed token for refresh_token grants', async () => {
      mockBetterAuthPost.mockResolvedValue(
        jsonResponse(200, { access_token: 'new', token_type: 'Bearer' }),
      )

      await routeModule.POST(
        buildTokenRequest({ grant_type: 'refresh_token', refresh_token: 'rt-value' }),
      )

      expect(mockHashRefreshToken).toHaveBeenCalledWith('rt-value')
      expect(mockDedupeRefreshRequest).toHaveBeenCalledOnce()
      expect(mockDedupeRefreshRequest).toHaveBeenCalledWith(
        'hash(rt-value)',
        expect.any(Function),
      )
    })

    it('does NOT call dedupe for authorization_code grants', async () => {
      mockBetterAuthPost.mockResolvedValue(
        jsonResponse(200, { access_token: 'new', token_type: 'Bearer' }),
      )

      await routeModule.POST(
        buildTokenRequest({ grant_type: 'authorization_code', code: 'xyz' }),
      )

      expect(mockDedupeRefreshRequest).not.toHaveBeenCalled()
    })

    it('does NOT call dedupe when refresh_token is missing', async () => {
      mockBetterAuthPost.mockResolvedValue(
        jsonResponse(400, { error: 'invalid_request' }),
      )

      await routeModule.POST(
        buildTokenRequest({ grant_type: 'refresh_token' }),
      )

      expect(mockDedupeRefreshRequest).not.toHaveBeenCalled()
    })

    it('cached response from dedupe is returned without calling better-auth', async () => {
      // Override the dedupe mock to return a cached response directly.
      mockDedupeRefreshRequest.mockImplementationOnce(async () => {
        return new Response(JSON.stringify({ access_token: 'cached' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      })

      const res = await routeModule.POST(
        buildTokenRequest({ grant_type: 'refresh_token', refresh_token: 'rt' }),
      )

      const body = await res.json()
      expect(body).toEqual({ access_token: 'cached' })
      expect(mockBetterAuthPost).not.toHaveBeenCalled()
    })

    it('forwarded response goes through PR #14 remap before reaching dedupe cache', async () => {
      // Capture what the forward fn returns so we can assert remap happened.
      // We clone forwardResult immediately in the mock so both the response
      // returned to the caller and our captured copy have readable bodies.
      let forwardBody: unknown = null
      mockDedupeRefreshRequest.mockImplementationOnce(async (_h, forward) => {
        const forwardResult = await forward()
        // Clone before returning so both paths can read the body.
        forwardBody = await forwardResult.clone().json()
        return forwardResult
      })

      mockBetterAuthPost.mockResolvedValue(
        jsonResponse(400, { error: 'invalid_request', error_description: 'session not found' }),
      )

      const res = await routeModule.POST(
        buildTokenRequest({ grant_type: 'refresh_token', refresh_token: 'bogus' }),
      )

      const body = await res.json()
      expect(body.error).toBe('invalid_grant')
      // The forward fn (what dedupe will cache) also got the remapped body.
      expect(forwardBody).not.toBeNull()
      expect((forwardBody as { error: string }).error).toBe('invalid_grant')
    })
  })
})
