import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Mock better-auth/cookies -- control getSessionCookie return per test
const mockGetSessionCookie = vi.fn()
vi.mock('better-auth/cookies', () => ({
  getSessionCookie: (...args: unknown[]) => mockGetSessionCookie(...args),
}))

// Import after mocking
const { proxy, config } = await import('../proxy')

function createRequest(pathname: string, method = 'GET'): NextRequest {
  return new NextRequest(new URL(pathname, 'http://localhost:3001'), {
    method,
  })
}

describe('proxy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('development mode', () => {
    beforeEach(() => {
      vi.stubEnv('NODE_ENV', 'development')
    })

    it('passes all requests through without auth check', () => {
      const response = proxy(createRequest('/discovery'))
      expect(response.status).toBe(200)
      expect(response.headers.get('x-middleware-next')).toBe('1')
      expect(mockGetSessionCookie).not.toHaveBeenCalled()
    })

    it('passes API requests through without auth check', () => {
      const response = proxy(createRequest('/api/videos'))
      expect(response.status).toBe(200)
      expect(response.headers.get('x-middleware-next')).toBe('1')
      expect(mockGetSessionCookie).not.toHaveBeenCalled()
    })
  })

  describe('production mode', () => {
    beforeEach(() => {
      vi.stubEnv('NODE_ENV', 'production')
    })

    describe('public routes', () => {
      it('redirects / to /sign-in without auth', () => {
        mockGetSessionCookie.mockReturnValue(null)
        const response = proxy(createRequest('/'))
        expect(response.status).toBe(307)
        const location = new URL(response.headers.get('location')!)
        expect(location.pathname).toBe('/sign-in')
        expect(location.searchParams.get('callbackUrl')).toBe('/')
      })

      it('allows /sign-in without auth', () => {
        const response = proxy(createRequest('/sign-in'))
        expect(response.status).toBe(200)
        expect(response.headers.get('x-middleware-next')).toBe('1')
        expect(mockGetSessionCookie).not.toHaveBeenCalled()
      })

      it('allows /consent without auth', () => {
        const response = proxy(createRequest('/consent'))
        expect(response.status).toBe(200)
        expect(response.headers.get('x-middleware-next')).toBe('1')
        expect(mockGetSessionCookie).not.toHaveBeenCalled()
      })

      it('allows /api/auth/* without auth', () => {
        const response = proxy(createRequest('/api/auth/callback/google'))
        expect(response.status).toBe(200)
        expect(response.headers.get('x-middleware-next')).toBe('1')
        expect(mockGetSessionCookie).not.toHaveBeenCalled()
      })

      it('allows /.well-known/* without auth', () => {
        const response = proxy(createRequest('/.well-known/oauth-authorization-server'))
        expect(response.status).toBe(200)
        expect(response.headers.get('x-middleware-next')).toBe('1')
        expect(mockGetSessionCookie).not.toHaveBeenCalled()
      })

      it('allows /api/cron/* without auth', () => {
        const response = proxy(createRequest('/api/cron/check-feeds'))
        expect(response.status).toBe(200)
        expect(response.headers.get('x-middleware-next')).toBe('1')
        expect(mockGetSessionCookie).not.toHaveBeenCalled()
      })

      it('allows /opengraph-image without auth', () => {
        const response = proxy(createRequest('/opengraph-image'))
        expect(response.status).toBe(200)
        expect(response.headers.get('x-middleware-next')).toBe('1')
        expect(mockGetSessionCookie).not.toHaveBeenCalled()
      })

      it('allows /twitter-image without auth', () => {
        const response = proxy(createRequest('/twitter-image'))
        expect(response.status).toBe(200)
        expect(response.headers.get('x-middleware-next')).toBe('1')
        expect(mockGetSessionCookie).not.toHaveBeenCalled()
      })
    })

    describe('authenticated requests', () => {
      beforeEach(() => {
        mockGetSessionCookie.mockReturnValue('valid-session-token')
      })

      it('allows authenticated page requests through', () => {
        const response = proxy(createRequest('/discovery'))
        expect(response.status).toBe(200)
        expect(response.headers.get('x-middleware-next')).toBe('1')
        expect(mockGetSessionCookie).toHaveBeenCalled()
      })

      it('allows authenticated API requests through', () => {
        const response = proxy(createRequest('/api/videos'))
        expect(response.status).toBe(200)
        expect(response.headers.get('x-middleware-next')).toBe('1')
        expect(mockGetSessionCookie).toHaveBeenCalled()
      })
    })

    describe('unauthenticated requests', () => {
      beforeEach(() => {
        mockGetSessionCookie.mockReturnValue(null)
      })

      it('redirects unauthenticated page requests to /sign-in', () => {
        const response = proxy(createRequest('/discovery'))
        expect(response.status).toBe(307)
        const location = new URL(response.headers.get('location')!)
        expect(location.pathname).toBe('/sign-in')
        expect(location.searchParams.get('callbackUrl')).toBe('/discovery')
      })

      it('redirects unauthenticated nested page requests with callbackUrl', () => {
        const response = proxy(createRequest('/videos/123'))
        expect(response.status).toBe(307)
        const location = new URL(response.headers.get('location')!)
        expect(location.pathname).toBe('/sign-in')
        expect(location.searchParams.get('callbackUrl')).toBe('/videos/123')
      })

      it('returns 401 JSON for unauthenticated API requests', async () => {
        const response = proxy(createRequest('/api/videos'))
        expect(response.status).toBe(401)
        expect(response.headers.get('content-type')).toContain('application/json')
        const body = await response.json()
        expect(body).toEqual({ error: 'Unauthorized' })
      })

      it('returns 401 for unauthenticated nested API requests', async () => {
        const response = proxy(createRequest('/api/videos/1/insights'))
        expect(response.status).toBe(401)
        const body = await response.json()
        expect(body).toEqual({ error: 'Unauthorized' })
      })
    })

    describe('getSessionCookie integration', () => {
      it('passes the NextRequest to getSessionCookie', () => {
        mockGetSessionCookie.mockReturnValue('token')
        const request = createRequest('/discovery')
        proxy(request)
        expect(mockGetSessionCookie).toHaveBeenCalledWith(request)
      })
    })
  })

  describe('config', () => {
    it('exports a matcher config', () => {
      expect(config).toBeDefined()
      expect(config.matcher).toBeDefined()
      expect(Array.isArray(config.matcher)).toBe(true)
      expect(config.matcher.length).toBeGreaterThan(0)
    })

    it('matcher excludes static files via regex pattern', () => {
      const pattern = config.matcher[0]
      expect(pattern).toContain('_next/static')
      expect(pattern).toContain('_next/image')
      expect(pattern).toContain('favicon')
    })
  })
})
