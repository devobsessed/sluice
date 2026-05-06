import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { setupTestDb, teardownTestDb, getTestDb, schema } from '@/lib/db/__tests__/setup'

// Use the real test DB for @/lib/db. The dedupe helper uses db.transaction +
// pg_advisory_xact_lock - both work against the test DB.
vi.mock('@/lib/db', async () => {
  const setup = await import('@/lib/db/__tests__/setup')
  await setup.setupTestDb()
  return { db: setup.getTestDb(), pool: undefined }
})

// Mock better-auth's POST so we control concurrency timing.
const mockBetterAuthPost = vi.fn()
vi.mock('@/lib/auth', () => ({ auth: {} }))
vi.mock('better-auth/next-js', () => ({
  toNextJsHandler: () => ({
    GET: vi.fn(),
    POST: (req: Request) => mockBetterAuthPost(req),
  }),
}))

const routeModule = await import('../route')

function buildRefreshRequest(token: string): Request {
  return new Request('http://localhost/api/auth/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: token }).toString(),
  })
}

describe('OAuth route - race scenarios (real DB)', () => {
  beforeEach(async () => {
    await setupTestDb()
    vi.clearAllMocks()
  })

  afterAll(async () => {
    await teardownTestDb()
  })

  it('A1: two concurrent identical refresh requests produce identical responses, better-auth called once', async () => {
    let callCount = 0
    mockBetterAuthPost.mockImplementation(async () => {
      callCount += 1
      // Hold the request open so the second one can enter and block on lock.
      await new Promise((resolve) => setTimeout(resolve, 50))
      return new Response(
        JSON.stringify({ access_token: `token-${callCount}`, token_type: 'Bearer' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    })

    const [r1, r2] = await Promise.all([
      routeModule.POST(buildRefreshRequest('shared-rt-value')),
      routeModule.POST(buildRefreshRequest('shared-rt-value')),
    ])

    expect(callCount).toBe(1)
    const b1 = await r1.json()
    const b2 = await r2.json()
    expect(b1).toEqual(b2)
    expect(b1.access_token).toBe('token-1')
  })

  it('A2: PR #14 remap applies to the cached response too', async () => {
    mockBetterAuthPost.mockResolvedValue(
      new Response(
        JSON.stringify({ error: 'invalid_request', error_description: 'session not found' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    const r1 = await routeModule.POST(buildRefreshRequest('bad-rt'))
    const r2 = await routeModule.POST(buildRefreshRequest('bad-rt'))

    expect(mockBetterAuthPost).toHaveBeenCalledTimes(1)
    expect((await r1.json()).error).toBe('invalid_grant')
    expect((await r2.json()).error).toBe('invalid_grant')
  })

  it('A5: cache row past TTL is replaced on next request', async () => {
    const db = getTestDb()
    // Pre-seed an expired cache row.
    const { hashRefreshToken } = await import('@/lib/auth/refresh-dedupe')
    const tokenHash = hashRefreshToken('expired-rt')
    await db.insert(schema.oauthRefreshDedupe).values({
      tokenHash,
      response: {
        status: 200,
        body: JSON.stringify({ access_token: 'STALE' }),
        headers: [['content-type', 'application/json']],
      },
      expiresAt: new Date(Date.now() - 1000),
    })

    mockBetterAuthPost.mockResolvedValue(
      new Response(JSON.stringify({ access_token: 'FRESH' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const r = await routeModule.POST(buildRefreshRequest('expired-rt'))
    const body = await r.json()
    expect(body.access_token).toBe('FRESH')
    expect(mockBetterAuthPost).toHaveBeenCalledTimes(1)
  })
})
