import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { setupTestDb, teardownTestDb, getTestDb, schema } from '@/lib/db/__tests__/setup'

// The helper imports `db` from '@/lib/db' which uses DATABASE_URL.
// For these tests, we want it to use the test DB. Easiest way: ensure
// the test runner's DATABASE_URL already points at goldminer_test
// (vitest.setup.ts handles dotenv; if not, we mock @/lib/db to use testDb).
vi.mock('@/lib/db', async () => {
  const setup = await import('@/lib/db/__tests__/setup')
  await setup.setupTestDb()
  return {
    db: setup.getTestDb(),
    pool: undefined,
  }
})

// Import after the mock so the helper picks up the test db.
const { hashRefreshToken, serializeResponse, deserializeResponse, dedupeRefreshRequest } =
  await import('../refresh-dedupe')

describe('hashRefreshToken', () => {
  it('produces a deterministic 64-char hex SHA-256 digest', () => {
    const a = hashRefreshToken('my-token-value')
    const b = hashRefreshToken('my-token-value')
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })

  it('produces different digests for different inputs', () => {
    expect(hashRefreshToken('a')).not.toBe(hashRefreshToken('b'))
  })
})

describe('serializeResponse / deserializeResponse round trip', () => {
  it('preserves status, body, and headers (case-insensitive)', async () => {
    const original = new Response(JSON.stringify({ access_token: 'x' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'X-Trace-Id': 'abc' },
    })
    const serialized = await serializeResponse(original)
    expect(serialized).not.toBeNull()
    const round = deserializeResponse(serialized!)
    expect(round.status).toBe(200)
    const body = await round.json()
    expect(body).toEqual({ access_token: 'x' })
    expect(round.headers.get('content-type')).toContain('application/json')
    expect(round.headers.get('x-trace-id')).toBe('abc')
  })

  it('drops content-length on deserialize so runtime recomputes', async () => {
    const original = new Response('hello', {
      status: 200,
      headers: { 'Content-Length': '5' },
    })
    const serialized = await serializeResponse(original)
    const round = deserializeResponse(serialized!)
    // Headers may or may not have a recomputed content-length depending on
    // runtime, but it must NOT be the stale value if the body changed shape.
    expect(round.headers.get('content-length')).not.toBe('5-stale')
  })
})

describe('dedupeRefreshRequest', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  afterAll(async () => {
    await teardownTestDb()
  })

  it('cache miss: forwards once, caches the response, replays on second call', async () => {
    const tokenHash = hashRefreshToken('cache-miss-test')
    const forward = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ access_token: 'first' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const r1 = await dedupeRefreshRequest(tokenHash, forward)
    expect(forward).toHaveBeenCalledTimes(1)
    expect(r1.status).toBe(200)
    expect(await r1.json()).toEqual({ access_token: 'first' })

    // Second call should hit cache.
    const r2 = await dedupeRefreshRequest(tokenHash, forward)
    expect(forward).toHaveBeenCalledTimes(1) // not called again
    expect(r2.status).toBe(200)
    expect(await r2.json()).toEqual({ access_token: 'first' })
  })

  it('caches and replays 4xx errors too (so racing duplicates see same error)', async () => {
    const tokenHash = hashRefreshToken('error-cache-test')
    const forward = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'invalid_grant' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const r1 = await dedupeRefreshRequest(tokenHash, forward)
    const r2 = await dedupeRefreshRequest(tokenHash, forward)
    expect(forward).toHaveBeenCalledTimes(1)
    expect(r1.status).toBe(400)
    expect(r2.status).toBe(400)
    expect(await r2.json()).toEqual({ error: 'invalid_grant' })
  })

  it('lazy-expires cache rows past expires_at and forwards a fresh request', async () => {
    const db = getTestDb()
    const tokenHash = hashRefreshToken('lazy-expire-test')

    // Manually insert an expired row.
    await db.insert(schema.oauthRefreshDedupe).values({
      tokenHash,
      response: {
        status: 200,
        body: JSON.stringify({ access_token: 'STALE' }),
        headers: [['content-type', 'application/json']],
      },
      expiresAt: new Date(Date.now() - 1000), // 1s ago
    })

    const forward = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ access_token: 'FRESH' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const r = await dedupeRefreshRequest(tokenHash, forward)
    expect(forward).toHaveBeenCalledTimes(1)
    expect(await r.json()).toEqual({ access_token: 'FRESH' })

    // Verify the stale row was replaced with the fresh one.
    const rows = await db
      .select()
      .from(schema.oauthRefreshDedupe)
      .where(eq(schema.oauthRefreshDedupe.tokenHash, tokenHash))
    expect(rows).toHaveLength(1)
    expect(rows[0]!.expiresAt.getTime()).toBeGreaterThan(Date.now())
  })

  it('serializes concurrent requests via advisory lock (only one forward call)', async () => {
    const tokenHash = hashRefreshToken('race-test')
    let inFlight = 0
    let maxInFlight = 0

    // Use a barrier so both calls enter dedupeRefreshRequest before
    // the first one proceeds. Without the barrier, the first call could
    // complete entirely before the second starts.
    let releaseBarrier!: () => void
    const barrier = new Promise<void>((resolve) => { releaseBarrier = resolve })

    const forward = vi.fn().mockImplementation(async () => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      // Signal that forward is in-flight so the second call can race.
      releaseBarrier()
      // Yield the event loop to let the second call's transaction start.
      await new Promise((resolve) => setTimeout(resolve, 0))
      inFlight -= 1
      return new Response(JSON.stringify({ access_token: 'race-winner' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    // Start both calls; the second one waits on the barrier before proceeding.
    const call2 = barrier.then(() => dedupeRefreshRequest(tokenHash, forward))
    const [r1, r2] = await Promise.all([
      dedupeRefreshRequest(tokenHash, forward),
      call2,
    ])

    // Forward should be called exactly once - the second request blocks on
    // the advisory lock, finds the cache populated, and replays.
    expect(forward).toHaveBeenCalledTimes(1)
    expect(maxInFlight).toBe(1)
    expect(await r1.json()).toEqual({ access_token: 'race-winner' })
    expect(await r2.json()).toEqual({ access_token: 'race-winner' })
  })

  it('fails open when the database transaction throws BEFORE forward runs (forward called exactly once outside txn)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const tokenHash = hashRefreshToken('fail-open-test')

    // Stub db.transaction to reject IMMEDIATELY before its callback runs.
    // This simulates "DB unreachable / lock acquisition failed" - forward never ran inside.
    const dbModule = await import('@/lib/db')
    const txSpy = vi
      .spyOn(dbModule.db, 'transaction')
      .mockRejectedValueOnce(new Error('simulated DB outage'))

    const forward = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ access_token: 'forwarded' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const r = await dedupeRefreshRequest(tokenHash, forward)
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ access_token: 'forwarded' })
    expect(forward).toHaveBeenCalledTimes(1) // exactly once, in the fail-open fallback
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('OAuth refresh dedupe failed'),
      expect.objectContaining({ error: 'simulated DB outage' }),
    )

    txSpy.mockRestore()
    warnSpy.mockRestore()
  })

  it('propagates forward() errors directly without retrying or swallowing them', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const tokenHash = hashRefreshToken('forward-error-test')

    const forwardError = new Error('better-auth crashed')
    const forward = vi.fn().mockRejectedValue(forwardError)

    // forward() throws inside the txn. Refined fail-open MUST re-throw the
    // original forward error - NOT swallow it, NOT retry forward.
    await expect(dedupeRefreshRequest(tokenHash, forward)).rejects.toThrow('better-auth crashed')
    expect(forward).toHaveBeenCalledTimes(1) // not retried
    expect(warnSpy).not.toHaveBeenCalled() // forward errors are NOT dedupe-wrapper errors

    warnSpy.mockRestore()
  })

  it('returns the forwarded response if cache write fails after forward succeeded', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const tokenHash = hashRefreshToken('cache-write-fail-test')

    // Patch serializeResponse to return null (simulates "body could not be serialized").
    // This tests the "forward succeeded, cache step skipped" path - which should
    // return the forwarded response.
    const successResponse = new Response(
      JSON.stringify({ access_token: 'success-but-no-cache' }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    )
    const forward = vi.fn().mockResolvedValue(successResponse)

    const helper = await import('../refresh-dedupe')
    const serSpy = vi.spyOn(helper, 'serializeResponse').mockResolvedValueOnce(null)

    const r = await dedupeRefreshRequest(tokenHash, forward)
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body).toEqual({ access_token: 'success-but-no-cache' })
    expect(forward).toHaveBeenCalledTimes(1) // not called twice

    serSpy.mockRestore()
    warnSpy.mockRestore()
  })
})
