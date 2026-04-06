import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { JWTPayload } from 'jose'

// Mock jose before importing auth-guards
vi.mock('jose', () => {
  const mockJwks = vi.fn()
  const mockCreateRemoteJWKSet = vi.fn(() => mockJwks)
  const mockJwtVerify = vi.fn()

  return {
    createRemoteJWKSet: mockCreateRemoteJWKSet,
    jwtVerify: mockJwtVerify,
  }
})

// Mock next/server (required by auth-guards)
vi.mock('next/server', () => ({
  NextResponse: {
    json: vi.fn((body: unknown, init?: ResponseInit) => ({ body, status: init?.status ?? 200 })),
  },
}))

// Mock @/lib/auth (required by auth-guards)
vi.mock('@/lib/auth', () => ({
  auth: {
    api: { getSession: vi.fn() },
  },
}))

// Mock next/headers (required by auth-guards)
vi.mock('next/headers', () => ({
  headers: vi.fn(() => new Headers()),
}))

import { createRemoteJWKSet, jwtVerify } from 'jose'
import { verifyExternalJwt, _resetJwksCache } from '../auth-guards'

const mockCreateRemoteJWKSet = vi.mocked(createRemoteJWKSet)
const mockJwtVerify = vi.mocked(jwtVerify)

// Helper to set MCP_EXTERNAL_AUTH_PROVIDERS env var
function setProviders(providers: Array<Record<string, unknown>>): void {
  process.env.MCP_EXTERNAL_AUTH_PROVIDERS = JSON.stringify(providers)
}

const CLERK_PROVIDER = {
  name: 'clerk',
  jwksUrl: 'https://clerk.example.dev/.well-known/jwks.json',
  issuer: 'https://clerk.example.dev',
  audience: 'sluice-mcp',
}

const AUTH0_PROVIDER = {
  name: 'auth0',
  jwksUrl: 'https://auth0.example.com/.well-known/jwks.json',
  issuer: 'https://auth0.example.com/',
  audience: 'sluice-mcp-api',
}

describe('verifyExternalJwt', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    delete process.env.MCP_EXTERNAL_AUTH_PROVIDERS
    _resetJwksCache()
    vi.clearAllMocks()
    mockCreateRemoteJWKSet.mockImplementation(
      () => vi.fn() as unknown as ReturnType<typeof createRemoteJWKSet>,
    )
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('when no providers are configured', () => {
    it('returns valid: false when MCP_EXTERNAL_AUTH_PROVIDERS is not set', async () => {
      const result = await verifyExternalJwt('some-token')
      expect(result.valid).toBe(false)
      expect(mockJwtVerify).not.toHaveBeenCalled()
    })

    it('returns valid: false when env var is empty string', async () => {
      process.env.MCP_EXTERNAL_AUTH_PROVIDERS = ''
      const result = await verifyExternalJwt('some-token')
      expect(result.valid).toBe(false)
    })

    it('returns valid: false and logs error when env var is invalid JSON', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      process.env.MCP_EXTERNAL_AUTH_PROVIDERS = 'not-json'
      const result = await verifyExternalJwt('some-token')
      expect(result.valid).toBe(false)
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('not valid JSON')
      )
      consoleSpy.mockRestore()
    })

    it('returns valid: false when env var is not an array', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      process.env.MCP_EXTERNAL_AUTH_PROVIDERS = '{"name": "clerk"}'
      const result = await verifyExternalJwt('some-token')
      expect(result.valid).toBe(false)
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('must be a JSON array')
      )
      consoleSpy.mockRestore()
    })
  })

  describe('when token is null', () => {
    it('returns valid: false without checking providers', async () => {
      setProviders([CLERK_PROVIDER])
      const result = await verifyExternalJwt(null)
      expect(result.valid).toBe(false)
      expect(mockJwtVerify).not.toHaveBeenCalled()
    })
  })

  describe('provider validation', () => {
    it('skips providers missing audience', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      setProviders([{ name: 'no-aud', jwksUrl: 'https://example.com/.well-known/jwks.json' }])
      const result = await verifyExternalJwt('some-token')
      expect(result.valid).toBe(false)
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('missing "audience"')
      )
      consoleSpy.mockRestore()
    })

    it('skips providers missing jwksUrl', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      setProviders([{ name: 'no-url', audience: 'test' }])
      const result = await verifyExternalJwt('some-token')
      expect(result.valid).toBe(false)
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('missing "jwksUrl"')
      )
      consoleSpy.mockRestore()
    })

    it('skips providers missing name', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      setProviders([{ jwksUrl: 'https://example.com/.well-known/jwks.json', audience: 'test' }])
      const result = await verifyExternalJwt('some-token')
      expect(result.valid).toBe(false)
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('missing "name"')
      )
      consoleSpy.mockRestore()
    })
  })

  describe('single provider - success', () => {
    it('returns valid: true with payload and provider name', async () => {
      setProviders([CLERK_PROVIDER])
      const mockPayload: JWTPayload = {
        sub: 'user_abc123',
        iss: CLERK_PROVIDER.issuer,
        aud: CLERK_PROVIDER.audience,
      }
      mockJwtVerify.mockResolvedValueOnce({
        payload: mockPayload,
        protectedHeader: { alg: 'RS256' },
      } as Awaited<ReturnType<typeof jwtVerify>>)

      const result = await verifyExternalJwt('valid.jwt.token')

      expect(result.valid).toBe(true)
      if (result.valid) {
        expect(result.payload.sub).toBe('user_abc123')
        expect(result.provider).toBe('clerk')
      }
    })

    it('passes audience to jwtVerify options (always required)', async () => {
      setProviders([CLERK_PROVIDER])
      const mockPayload: JWTPayload = { sub: 'user_1' }
      mockJwtVerify.mockResolvedValueOnce({
        payload: mockPayload,
        protectedHeader: { alg: 'RS256' },
      } as Awaited<ReturnType<typeof jwtVerify>>)

      await verifyExternalJwt('valid.jwt.token')

      expect(mockJwtVerify).toHaveBeenCalledWith(
        'valid.jwt.token',
        expect.any(Function),
        expect.objectContaining({
          issuer: CLERK_PROVIDER.issuer,
          audience: CLERK_PROVIDER.audience,
        }),
      )
    })

    it('omits issuer when not configured on provider', async () => {
      setProviders([{ name: 'no-issuer', jwksUrl: CLERK_PROVIDER.jwksUrl, audience: 'test' }])
      const mockPayload: JWTPayload = { sub: 'user_1' }
      mockJwtVerify.mockResolvedValueOnce({
        payload: mockPayload,
        protectedHeader: { alg: 'RS256' },
      } as Awaited<ReturnType<typeof jwtVerify>>)

      await verifyExternalJwt('token')

      const callArgs = mockJwtVerify.mock.calls[0]
      const options = callArgs?.[2] as Record<string, unknown>
      expect(options).not.toHaveProperty('issuer')
      expect(options).toHaveProperty('audience', 'test')
    })
  })

  describe('single provider - failure', () => {
    it('returns valid: false and logs debug on verification failure', async () => {
      const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
      setProviders([CLERK_PROVIDER])
      mockJwtVerify.mockRejectedValueOnce(new Error('JWS Invalid Signature'))

      const result = await verifyExternalJwt('bad.token')

      expect(result.valid).toBe(false)
      expect(debugSpy).toHaveBeenCalledWith(
        expect.stringContaining('clerk')
      )
      expect(debugSpy).toHaveBeenCalledWith(
        expect.stringContaining('JWS Invalid Signature')
      )
      debugSpy.mockRestore()
    })
  })

  describe('multi-provider iteration', () => {
    it('tries second provider when first rejects', async () => {
      const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
      setProviders([CLERK_PROVIDER, AUTH0_PROVIDER])

      // First provider rejects
      mockJwtVerify.mockRejectedValueOnce(new Error('JWT Audience Invalid'))
      // Second provider accepts
      const mockPayload: JWTPayload = { sub: 'user_from_auth0' }
      mockJwtVerify.mockResolvedValueOnce({
        payload: mockPayload,
        protectedHeader: { alg: 'RS256' },
      } as Awaited<ReturnType<typeof jwtVerify>>)

      const result = await verifyExternalJwt('auth0.jwt.token')

      expect(result.valid).toBe(true)
      if (result.valid) {
        expect(result.provider).toBe('auth0')
        expect(result.payload.sub).toBe('user_from_auth0')
      }
      // Debug log for the first provider's rejection
      expect(debugSpy).toHaveBeenCalledWith(
        expect.stringContaining('clerk')
      )
      debugSpy.mockRestore()
    })

    it('returns valid: false when all providers reject', async () => {
      const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
      setProviders([CLERK_PROVIDER, AUTH0_PROVIDER])

      mockJwtVerify.mockRejectedValueOnce(new Error('JWT Audience Invalid'))
      mockJwtVerify.mockRejectedValueOnce(new Error('JWT Expired'))

      const result = await verifyExternalJwt('rejected.everywhere')

      expect(result.valid).toBe(false)
      expect(debugSpy).toHaveBeenCalledTimes(2)
      debugSpy.mockRestore()
    })

    it('stops iteration on first successful provider', async () => {
      setProviders([CLERK_PROVIDER, AUTH0_PROVIDER])
      const mockPayload: JWTPayload = { sub: 'user_1' }
      mockJwtVerify.mockResolvedValueOnce({
        payload: mockPayload,
        protectedHeader: { alg: 'RS256' },
      } as Awaited<ReturnType<typeof jwtVerify>>)

      await verifyExternalJwt('token')

      // Only one call - stopped after first match
      expect(mockJwtVerify).toHaveBeenCalledTimes(1)
    })
  })

  describe('JWKS resolver caching (Map-based)', () => {
    it('creates resolver once per unique URL across multiple calls', async () => {
      setProviders([CLERK_PROVIDER])
      const mockPayload: JWTPayload = { sub: 'user_1' }
      mockJwtVerify.mockResolvedValue({
        payload: mockPayload,
        protectedHeader: { alg: 'RS256' },
      } as Awaited<ReturnType<typeof jwtVerify>>)

      await verifyExternalJwt('token1')
      await verifyExternalJwt('token2')
      await verifyExternalJwt('token3')

      expect(mockCreateRemoteJWKSet).toHaveBeenCalledTimes(1)
    })

    it('caches resolvers independently for different URLs', async () => {
      setProviders([CLERK_PROVIDER, AUTH0_PROVIDER])
      // Both providers succeed (first match wins, but we want to see both URLs cached)
      mockJwtVerify.mockRejectedValueOnce(new Error('fail'))
      const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
      const mockPayload: JWTPayload = { sub: 'user_1' }
      mockJwtVerify.mockResolvedValueOnce({
        payload: mockPayload,
        protectedHeader: { alg: 'RS256' },
      } as Awaited<ReturnType<typeof jwtVerify>>)

      await verifyExternalJwt('token1')

      // Both URLs should have resolvers created
      expect(mockCreateRemoteJWKSet).toHaveBeenCalledTimes(2)

      // Second call - resolvers are cached, no new creation
      vi.clearAllMocks()
      mockCreateRemoteJWKSet.mockImplementation(
        () => vi.fn() as unknown as ReturnType<typeof createRemoteJWKSet>,
      )
      mockJwtVerify.mockRejectedValueOnce(new Error('fail'))
      mockJwtVerify.mockResolvedValueOnce({
        payload: mockPayload,
        protectedHeader: { alg: 'RS256' },
      } as Awaited<ReturnType<typeof jwtVerify>>)

      await verifyExternalJwt('token2')

      expect(mockCreateRemoteJWKSet).toHaveBeenCalledTimes(0)
      debugSpy.mockRestore()
    })

    it('_resetJwksCache clears all cached resolvers', async () => {
      setProviders([CLERK_PROVIDER])
      const mockPayload: JWTPayload = { sub: 'user_1' }
      mockJwtVerify.mockResolvedValue({
        payload: mockPayload,
        protectedHeader: { alg: 'RS256' },
      } as Awaited<ReturnType<typeof jwtVerify>>)

      await verifyExternalJwt('token1')
      _resetJwksCache()
      await verifyExternalJwt('token2')

      expect(mockCreateRemoteJWKSet).toHaveBeenCalledTimes(2)
    })
  })
})
