import { describe, it, expect, beforeEach, afterEach } from 'vitest'

const baseUrl = 'https://sluice.vercel.app'

// Import the route (no mocks needed — route only reads process.env)
const { GET } = await import('../route')

describe('OAuth Protected Resource Metadata Route', () => {
  const originalNodeEnv = process.env.NODE_ENV
  const originalBetterAuthUrl = process.env.BETTER_AUTH_URL

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv
    if (originalBetterAuthUrl !== undefined) {
      process.env.BETTER_AUTH_URL = originalBetterAuthUrl
    } else {
      delete process.env.BETTER_AUTH_URL
    }
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
      process.env.BETTER_AUTH_URL = baseUrl
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
      expect(body.resource).toBe(baseUrl)
    })

    it('GET returns JSON with authorization_servers field', async () => {
      const response = await GET()
      const body = await response.json()
      expect(body).toHaveProperty('authorization_servers')
      expect(body.authorization_servers).toEqual([`${baseUrl}/api/auth`])
    })

    it('GET returns JSON with bearer_methods_supported field', async () => {
      const response = await GET()
      const body = await response.json()
      expect(body).toHaveProperty('bearer_methods_supported')
      expect(body.bearer_methods_supported).toEqual(['header'])
    })

    it('GET returns 500 when BETTER_AUTH_URL is missing', async () => {
      delete process.env.BETTER_AUTH_URL
      const response = await GET()
      expect(response.status).toBe(500)
      const body = await response.json()
      expect(body.error).toBe('BETTER_AUTH_URL not configured')
    })
  })
})
