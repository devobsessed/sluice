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

describe('verifyExternalJwt', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    _resetJwksCache()
    vi.clearAllMocks()
    // Restore createRemoteJWKSet to return a new mock function each time by default
    mockCreateRemoteJWKSet.mockImplementation(
      () => vi.fn() as unknown as ReturnType<typeof createRemoteJWKSet>,
    )
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('when no JWKS URL is configured', () => {
    it('returns valid: false when neither config nor env var has jwksUrl', async () => {
      delete process.env.MCP_JWKS_URL

      const result = await verifyExternalJwt('some-token')

      expect(result.valid).toBe(false)
      expect(mockJwtVerify).not.toHaveBeenCalled()
    })

    it('returns valid: false when config jwksUrl is empty string', async () => {
      delete process.env.MCP_JWKS_URL

      const result = await verifyExternalJwt('some-token', { jwksUrl: '' })

      expect(result.valid).toBe(false)
      expect(mockJwtVerify).not.toHaveBeenCalled()
    })
  })

  describe('when token is null', () => {
    it('returns valid: false without calling jwtVerify', async () => {
      process.env.MCP_JWKS_URL = 'https://example.clerk.accounts.dev/.well-known/jwks.json'

      const result = await verifyExternalJwt(null)

      expect(result.valid).toBe(false)
      expect(mockJwtVerify).not.toHaveBeenCalled()
    })

    it('returns valid: false even when config is explicitly provided', async () => {
      const result = await verifyExternalJwt(null, {
        jwksUrl: 'https://example.clerk.accounts.dev/.well-known/jwks.json',
      })

      expect(result.valid).toBe(false)
      expect(mockJwtVerify).not.toHaveBeenCalled()
    })
  })

  describe('when token verification succeeds', () => {
    it('returns valid: true with payload when jwtVerify resolves', async () => {
      const mockPayload: JWTPayload = {
        sub: 'user_abc123',
        iss: 'https://example.clerk.accounts.dev',
        aud: 'my-audience',
        exp: Math.floor(Date.now() / 1000) + 3600,
      }
      mockJwtVerify.mockResolvedValueOnce({
        payload: mockPayload,
        protectedHeader: { alg: 'RS256' },
      } as Awaited<ReturnType<typeof jwtVerify>>)

      const result = await verifyExternalJwt('valid.jwt.token', {
        jwksUrl: 'https://example.clerk.accounts.dev/.well-known/jwks.json',
        issuer: 'https://example.clerk.accounts.dev',
        audience: 'my-audience',
      })

      expect(result.valid).toBe(true)
      if (result.valid) {
        expect(result.payload.sub).toBe('user_abc123')
        expect(result.payload.iss).toBe('https://example.clerk.accounts.dev')
      }
    })

    it('passes issuer and audience options to jwtVerify', async () => {
      const mockPayload: JWTPayload = { sub: 'user_1' }
      mockJwtVerify.mockResolvedValueOnce({
        payload: mockPayload,
        protectedHeader: { alg: 'RS256' },
      } as Awaited<ReturnType<typeof jwtVerify>>)

      await verifyExternalJwt('valid.jwt.token', {
        jwksUrl: 'https://example.clerk.accounts.dev/.well-known/jwks.json',
        issuer: 'https://example.clerk.accounts.dev',
        audience: 'sluice-mcp',
      })

      expect(mockJwtVerify).toHaveBeenCalledWith(
        'valid.jwt.token',
        expect.any(Function),
        expect.objectContaining({
          issuer: 'https://example.clerk.accounts.dev',
          audience: 'sluice-mcp',
        }),
      )
    })

    it('resolves issuer and audience from env vars when not in config', async () => {
      process.env.MCP_JWKS_URL = 'https://env.clerk.accounts.dev/.well-known/jwks.json'
      process.env.MCP_JWT_ISSUER = 'https://env.clerk.accounts.dev'
      process.env.MCP_JWT_AUDIENCE = 'env-audience'

      const mockPayload: JWTPayload = { sub: 'user_env' }
      mockJwtVerify.mockResolvedValueOnce({
        payload: mockPayload,
        protectedHeader: { alg: 'RS256' },
      } as Awaited<ReturnType<typeof jwtVerify>>)

      const result = await verifyExternalJwt('env.jwt.token')

      expect(result.valid).toBe(true)
      expect(mockJwtVerify).toHaveBeenCalledWith(
        'env.jwt.token',
        expect.any(Function),
        expect.objectContaining({
          issuer: 'https://env.clerk.accounts.dev',
          audience: 'env-audience',
        }),
      )
    })

    it('omits issuer from jwtVerify options when not configured', async () => {
      const mockPayload: JWTPayload = { sub: 'user_noiss' }
      mockJwtVerify.mockResolvedValueOnce({
        payload: mockPayload,
        protectedHeader: { alg: 'RS256' },
      } as Awaited<ReturnType<typeof jwtVerify>>)

      await verifyExternalJwt('token', {
        jwksUrl: 'https://example.clerk.accounts.dev/.well-known/jwks.json',
        // no issuer, no audience
      })

      const callArgs = mockJwtVerify.mock.calls[0]
      expect(callArgs).toBeDefined()
      const options = callArgs?.[2] as Record<string, unknown>
      expect(options).not.toHaveProperty('issuer')
      expect(options).not.toHaveProperty('audience')
    })
  })

  describe('when token verification fails', () => {
    it('returns valid: false when jwtVerify throws (bad signature)', async () => {
      mockJwtVerify.mockRejectedValueOnce(new Error('JWS Invalid Signature'))

      const result = await verifyExternalJwt('bad.signature.token', {
        jwksUrl: 'https://example.clerk.accounts.dev/.well-known/jwks.json',
        issuer: 'https://example.clerk.accounts.dev',
      })

      expect(result.valid).toBe(false)
    })

    it('returns valid: false when jwtVerify throws (expired token)', async () => {
      mockJwtVerify.mockRejectedValueOnce(new Error('JWT Expired'))

      const result = await verifyExternalJwt('expired.jwt.token', {
        jwksUrl: 'https://example.clerk.accounts.dev/.well-known/jwks.json',
      })

      expect(result.valid).toBe(false)
    })

    it('returns valid: false when jwtVerify throws (wrong issuer)', async () => {
      mockJwtVerify.mockRejectedValueOnce(new Error('JWT Issuer Invalid'))

      const result = await verifyExternalJwt('wrong.issuer.token', {
        jwksUrl: 'https://example.clerk.accounts.dev/.well-known/jwks.json',
        issuer: 'https://expected.issuer.dev',
      })

      expect(result.valid).toBe(false)
    })

    it('returns valid: false when jwtVerify throws (wrong audience)', async () => {
      mockJwtVerify.mockRejectedValueOnce(new Error('JWT Audience Invalid'))

      const result = await verifyExternalJwt('wrong.audience.token', {
        jwksUrl: 'https://example.clerk.accounts.dev/.well-known/jwks.json',
        audience: 'expected-audience',
      })

      expect(result.valid).toBe(false)
    })

    it('does not throw - always returns result object', async () => {
      mockJwtVerify.mockRejectedValueOnce(new Error('Unexpected error'))

      await expect(
        verifyExternalJwt('any.token', {
          jwksUrl: 'https://example.clerk.accounts.dev/.well-known/jwks.json',
        }),
      ).resolves.toEqual({ valid: false })
    })
  })

  describe('JWKS resolver caching', () => {
    it('creates resolver once for the same URL across multiple calls', async () => {
      const jwksUrl = 'https://example.clerk.accounts.dev/.well-known/jwks.json'
      const mockPayload: JWTPayload = { sub: 'user_1' }
      mockJwtVerify.mockResolvedValue({
        payload: mockPayload,
        protectedHeader: { alg: 'RS256' },
      } as Awaited<ReturnType<typeof jwtVerify>>)

      await verifyExternalJwt('token1', { jwksUrl })
      await verifyExternalJwt('token2', { jwksUrl })
      await verifyExternalJwt('token3', { jwksUrl })

      // createRemoteJWKSet should only be called once for the same URL
      expect(mockCreateRemoteJWKSet).toHaveBeenCalledTimes(1)
    })

    it('creates a new resolver when URL changes', async () => {
      const mockPayload: JWTPayload = { sub: 'user_1' }
      mockJwtVerify.mockResolvedValue({
        payload: mockPayload,
        protectedHeader: { alg: 'RS256' },
      } as Awaited<ReturnType<typeof jwtVerify>>)

      await verifyExternalJwt('token1', {
        jwksUrl: 'https://first.clerk.accounts.dev/.well-known/jwks.json',
      })
      await verifyExternalJwt('token2', {
        jwksUrl: 'https://second.clerk.accounts.dev/.well-known/jwks.json',
      })

      expect(mockCreateRemoteJWKSet).toHaveBeenCalledTimes(2)
    })

    it('_resetJwksCache causes resolver to be recreated on next call', async () => {
      const jwksUrl = 'https://example.clerk.accounts.dev/.well-known/jwks.json'
      const mockPayload: JWTPayload = { sub: 'user_1' }
      mockJwtVerify.mockResolvedValue({
        payload: mockPayload,
        protectedHeader: { alg: 'RS256' },
      } as Awaited<ReturnType<typeof jwtVerify>>)

      await verifyExternalJwt('token1', { jwksUrl })
      _resetJwksCache()
      await verifyExternalJwt('token2', { jwksUrl })

      expect(mockCreateRemoteJWKSet).toHaveBeenCalledTimes(2)
    })

    it('createRemoteJWKSet is called with a URL instance', async () => {
      const jwksUrl = 'https://example.clerk.accounts.dev/.well-known/jwks.json'
      const mockPayload: JWTPayload = { sub: 'user_1' }
      mockJwtVerify.mockResolvedValueOnce({
        payload: mockPayload,
        protectedHeader: { alg: 'RS256' },
      } as Awaited<ReturnType<typeof jwtVerify>>)

      await verifyExternalJwt('token', { jwksUrl })

      expect(mockCreateRemoteJWKSet).toHaveBeenCalledWith(new URL(jwksUrl))
    })
  })
})
