import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock the database to avoid connection issues in tests
vi.mock('@/lib/db', () => ({
  db: {},
}))

// Mock verifyAccessToken from better-auth/oauth2
const mockVerifyAccessToken = vi.fn()
vi.mock('better-auth/oauth2', () => ({
  verifyAccessToken: (...args: unknown[]) => mockVerifyAccessToken(...args),
}))

// Mock verifyExternalJwt from auth-guards
const mockVerifyExternalJwt = vi.fn()
vi.mock('@/lib/auth-guards', () => ({
  verifyExternalJwt: (...args: unknown[]) => mockVerifyExternalJwt(...args),
}))

// Import after mocking
const routeModule = await import('../route')

describe('MCP Route Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: external JWT fails (no MCP_JWKS_URL configured), better-auth succeeds
    mockVerifyExternalJwt.mockResolvedValue({ valid: false })
    mockVerifyAccessToken.mockResolvedValue({ sub: 'user-1', scope: 'openid' })
  })

  it('exports GET handler', () => {
    expect(routeModule.GET).toBeDefined()
    expect(typeof routeModule.GET).toBe('function')
  })

  it('exports POST handler', () => {
    expect(routeModule.POST).toBeDefined()
    expect(typeof routeModule.POST).toBe('function')
  })

  it('GET and POST should be the same handler', () => {
    expect(routeModule.GET).toBe(routeModule.POST)
  })

  it('exports maxDuration config', () => {
    expect(routeModule.maxDuration).toBe(300)
  })

  it('returns a Response for POST requests', async () => {
    const request = new Request('http://localhost:3000/api/mcp/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: {
            name: 'test-client',
            version: '1.0.0',
          },
        },
      }),
    })

    const response = await routeModule.POST(request)
    expect(response).toBeInstanceOf(Response)
    // MCP handler should return 200 for valid initialize request
    expect(response.status).toBe(200)
  }, 10000)

  it('adds Accept header when missing', async () => {
    // Request without Accept header should still work
    // (wrappedHandler adds it before passing to mcp-handler)
    const request = new Request('http://localhost:3000/api/mcp/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: {
            name: 'test-client',
            version: '1.0.0',
          },
        },
      }),
    })

    const response = await routeModule.POST(request)
    expect(response).toBeInstanceOf(Response)
    expect(response.status).toBe(200)
  }, 10000)

  describe('authentication (production only)', () => {
    beforeEach(() => {
      vi.stubEnv('NODE_ENV', 'production')
    })

    afterEach(() => {
      vi.unstubAllEnvs()
    })

    it('rejects unauthenticated requests with 401 in production', async () => {
      // No Authorization header — should 401 without calling either verifier
      const request = new Request('http://localhost:3000/api/mcp/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'test-client', version: '1.0.0' },
          },
        }),
      })

      const response = await routeModule.POST(request)
      expect(response.status).toBe(401)

      const body = await response.json()
      expect(body.error).toBe('Unauthorized')

      // Neither verifier should have been called (no token to verify)
      expect(mockVerifyExternalJwt).not.toHaveBeenCalled()
      expect(mockVerifyAccessToken).not.toHaveBeenCalled()
    })

    it('includes WWW-Authenticate header on 401 (no token)', async () => {
      const request = new Request('http://localhost:3000/api/mcp/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'test-client', version: '1.0.0' },
          },
        }),
      })

      const response = await routeModule.POST(request)
      expect(response.status).toBe(401)
      const wwwAuth = response.headers.get('WWW-Authenticate')
      expect(wwwAuth).toBeTruthy()
      expect(wwwAuth).toContain('Bearer')
      expect(wwwAuth).toContain('resource_metadata=')
      expect(wwwAuth).toContain('/.well-known/oauth-protected-resource')
    })

    // --- External JWT (machine-to-machine) path ---

    it('allows requests with valid external JWT through to MCP handler', async () => {
      mockVerifyExternalJwt.mockResolvedValue({ valid: true, payload: { sub: 'service-account' }, provider: 'test-provider' })

      const request = new Request('http://localhost:3000/api/mcp/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'Authorization': 'Bearer valid-external-jwt',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'test-client', version: '1.0.0' },
          },
        }),
      })

      const response = await routeModule.POST(request)
      expect(response.status).toBe(200)

      // External JWT succeeded — better-auth fallback should NOT have been tried
      expect(mockVerifyAccessToken).not.toHaveBeenCalled()
    }, 10000)

    it('tries external JWT first before falling back to better-auth', async () => {
      // External JWT fails, better-auth succeeds
      mockVerifyExternalJwt.mockResolvedValue({ valid: false })
      mockVerifyAccessToken.mockResolvedValue({ sub: 'user-1', scope: 'openid' })

      const request = new Request('http://localhost:3000/api/mcp/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'Authorization': 'Bearer better-auth-token',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'test-client', version: '1.0.0' },
          },
        }),
      })

      await routeModule.POST(request)

      // Both paths should have been tried in order
      expect(mockVerifyExternalJwt).toHaveBeenCalledOnce()
      expect(mockVerifyAccessToken).toHaveBeenCalledOnce()
    }, 10000)

    it('skips better-auth fallback when external JWT succeeds', async () => {
      mockVerifyExternalJwt.mockResolvedValue({ valid: true, payload: { sub: 'service-account' }, provider: 'test-provider' })

      const request = new Request('http://localhost:3000/api/mcp/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'Authorization': 'Bearer external-jwt-token',
        },
        body: '{}',
      })

      await routeModule.POST(request)

      expect(mockVerifyExternalJwt).toHaveBeenCalledOnce()
      expect(mockVerifyAccessToken).not.toHaveBeenCalled()
    })

    // --- Better Auth (browser OAuth) path ---

    it('allows authenticated requests via better-auth through to MCP handler', async () => {
      mockVerifyExternalJwt.mockResolvedValue({ valid: false })
      mockVerifyAccessToken.mockResolvedValue({ sub: 'user-1', scope: 'openid' })

      const request = new Request('http://localhost:3000/api/mcp/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'Authorization': 'Bearer valid-oauth-token',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'test-client', version: '1.0.0' },
          },
        }),
      })

      const response = await routeModule.POST(request)
      expect(response.status).toBe(200)
    }, 10000)

    it('passes Bearer token to verifyAccessToken when external JWT fails', async () => {
      mockVerifyExternalJwt.mockResolvedValue({ valid: false })
      mockVerifyAccessToken.mockResolvedValue({ sub: 'user-1', scope: 'openid' })

      const request = new Request('http://localhost:3000/api/mcp/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer my-access-token',
        },
        body: '{}',
      })

      await routeModule.POST(request)

      expect(mockVerifyAccessToken).toHaveBeenCalledOnce()
      const [token, opts] = mockVerifyAccessToken.mock.calls[0] as [string, { verifyOptions: { issuer: string | undefined, audience: string[] | undefined } }]
      expect(token).toBe('my-access-token')
      expect(opts).toHaveProperty('verifyOptions')
      expect(opts.verifyOptions).toHaveProperty('issuer')
      expect(opts.verifyOptions).toHaveProperty('audience')
    })

    it('rejects requests when both auth paths fail', async () => {
      mockVerifyExternalJwt.mockResolvedValue({ valid: false })
      mockVerifyAccessToken.mockRejectedValue(new Error('Token expired'))

      const request = new Request('http://localhost:3000/api/mcp/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'Authorization': 'Bearer bad-token',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'test-client', version: '1.0.0' },
          },
        }),
      })

      const response = await routeModule.POST(request)
      expect(response.status).toBe(401)

      const body = await response.json()
      expect(body.error).toBe('Unauthorized')
    })

    it('includes WWW-Authenticate header on 401 when both auth paths fail', async () => {
      mockVerifyExternalJwt.mockResolvedValue({ valid: false })
      mockVerifyAccessToken.mockRejectedValue(new Error('Token expired'))

      const request = new Request('http://localhost:3000/api/mcp/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'Authorization': 'Bearer expired-token',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'test-client', version: '1.0.0' },
          },
        }),
      })

      const response = await routeModule.POST(request)
      expect(response.status).toBe(401)
      const wwwAuth = response.headers.get('WWW-Authenticate')
      expect(wwwAuth).toBeTruthy()
      expect(wwwAuth).toContain('Bearer')
      expect(wwwAuth).toContain('resource_metadata=')
      expect(wwwAuth).toContain('/.well-known/oauth-protected-resource')
    })

    it('passes Bearer token to verifyExternalJwt', async () => {
      mockVerifyExternalJwt.mockResolvedValue({ valid: true, payload: { sub: 'service-account' }, provider: 'test-provider' })

      const request = new Request('http://localhost:3000/api/mcp/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer my-external-jwt',
        },
        body: '{}',
      })

      await routeModule.POST(request)

      expect(mockVerifyExternalJwt).toHaveBeenCalledOnce()
      const [token] = mockVerifyExternalJwt.mock.calls[0] as [string]
      expect(token).toBe('my-external-jwt')
    })

    it('adds Accept header when missing for authenticated requests', async () => {
      mockVerifyExternalJwt.mockResolvedValue({ valid: false })
      mockVerifyAccessToken.mockResolvedValue({ sub: 'user-1', scope: 'openid' })

      // Request without Accept header — should still reach MCP handler after auth passes
      const request = new Request('http://localhost:3000/api/mcp/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer valid-oauth-token',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'test-client', version: '1.0.0' },
          },
        }),
      })

      const response = await routeModule.POST(request)
      // Auth passed and Accept header was injected — MCP handler should respond 200
      expect(response).toBeInstanceOf(Response)
      expect(response.status).toBe(200)
    }, 10000)

    it('skips auth check in development', async () => {
      vi.stubEnv('NODE_ENV', 'development')

      const request = new Request('http://localhost:3000/api/mcp/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'test-client', version: '1.0.0' },
          },
        }),
      })

      const response = await routeModule.POST(request)
      // Should pass through to MCP handler, not 401
      expect(response.status).toBe(200)
      expect(mockVerifyExternalJwt).not.toHaveBeenCalled()
      expect(mockVerifyAccessToken).not.toHaveBeenCalled()
    }, 10000)
  })
})
