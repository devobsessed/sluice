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
})
