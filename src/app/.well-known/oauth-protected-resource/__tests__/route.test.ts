import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock the database to avoid connection issues in tests
vi.mock('@/lib/db', () => ({
  db: {},
}))

const baseUrl = 'http://localhost:3001'

// Mock @better-auth/oauth-provider/resource-client — the protected resource metadata helper
vi.mock('@better-auth/oauth-provider/resource-client', () => ({
  oauthProviderResourceClient: vi.fn(() => ({
    id: 'oauth-provider-resource-client',
    getActions: () => ({
      getProtectedResourceMetadata: async () => ({
        resource: baseUrl,
        authorization_servers: [baseUrl],
        bearer_methods_supported: ['header'],
      }),
    }),
  })),
}))

// Mock @better-auth/oauth-provider
vi.mock('@better-auth/oauth-provider', () => ({
  oauthProvider: vi.fn(() => ({ id: 'oauth-provider' })),
}))

// Mock better-auth/plugins with jwt
vi.mock('better-auth/plugins', () => ({
  jwt: vi.fn(() => ({ id: 'jwt' })),
}))

// Mock better-auth core
vi.mock('better-auth', () => ({
  betterAuth: vi.fn(() => ({
    handler: vi.fn(),
    api: {},
    options: {},
  })),
}))

vi.mock('better-auth/adapters/drizzle', () => ({
  drizzleAdapter: vi.fn(() => ({})),
}))

vi.mock('better-auth/next-js', () => ({
  nextCookies: vi.fn(() => ({ id: 'next-cookies' })),
}))

vi.mock('better-auth/api', () => ({
  APIError: class APIError extends Error {
    constructor(code: string, options?: { message?: string }) {
      super(options?.message ?? code)
      this.name = 'APIError'
    }
  },
}))

// Import the route after mocking
const { GET } = await import('../route')

describe('OAuth Protected Resource Metadata Route', () => {
  const originalNodeEnv = process.env.NODE_ENV

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv
  })

  describe('dev mode (non-production)', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'test'
    })

    it('GET returns 404 so MCP clients skip OAuth', async () => {
      const response = await GET()
      expect(response).toBeInstanceOf(Response)
      expect(response.status).toBe(404)
    })

    it('GET returns empty body', async () => {
      const response = await GET()
      const text = await response.text()
      expect(text).toBe('')
    })
  })

  describe('production mode', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production'
    })

    it('GET returns 200 with JSON content', async () => {
      const response = await GET()
      expect(response).toBeInstanceOf(Response)
      expect(response.status).toBe(200)
    })

    it('GET returns JSON with resource field', async () => {
      const response = await GET()
      const body = await response.json()
      expect(body).toHaveProperty('resource')
      expect(typeof body.resource).toBe('string')
    })

    it('GET returns JSON with authorization_servers field', async () => {
      const response = await GET()
      const body = await response.json()
      expect(body).toHaveProperty('authorization_servers')
      expect(Array.isArray(body.authorization_servers)).toBe(true)
      expect(body.authorization_servers.length).toBeGreaterThan(0)
    })

    it('GET returns JSON with bearer_methods_supported field', async () => {
      const response = await GET()
      const body = await response.json()
      expect(body).toHaveProperty('bearer_methods_supported')
      expect(Array.isArray(body.bearer_methods_supported)).toBe(true)
    })

    it('GET returns all required RFC 9728 fields', async () => {
      const response = await GET()
      const body = await response.json()
      expect(body).toHaveProperty('resource')
      expect(body).toHaveProperty('authorization_servers')
      expect(body).toHaveProperty('bearer_methods_supported')
    })
  })
})
