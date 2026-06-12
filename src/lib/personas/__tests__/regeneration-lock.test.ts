import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { setupTestDb, teardownTestDb, getTestDb, schema } from '@/lib/db/__tests__/setup'
import {
  claimRegenerationLock,
  releaseRegenerationLock,
  waitForRegenerationToClear,
} from '../service'

/** Seeds a minimal persona row and returns its id */
async function seedPersona(channelName: string): Promise<number> {
  const db = getTestDb()
  const [persona] = await db
    .insert(schema.personas)
    .values({
      channelName,
      name: channelName,
      systemPrompt: 'Test system prompt',
      transcriptCount: 5,
    })
    .returning()

  if (!persona) throw new Error('Failed to seed persona')
  return persona.id
}

describe('claimRegenerationLock', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  afterAll(async () => {
    await teardownTestDb()
  })

  it('two concurrent claims: exactly one wins', async () => {
    const personaId = await seedPersona('Concurrent Test Channel')
    const db = getTestDb()

    // Fire both claims simultaneously - Postgres serializes the conditional
    // UPDATE so exactly one will see the predicate satisfied and return a row
    const [resultA, resultB] = await Promise.all([
      claimRegenerationLock(personaId, 300_000, db),
      claimRegenerationLock(personaId, 300_000, db),
    ])

    const winners = [resultA, resultB].filter(Boolean)
    const losers = [resultA, resultB].filter((r) => !r)

    expect(winners).toHaveLength(1)
    expect(losers).toHaveLength(1)
  })

  it('a fresh lock blocks a second claim', async () => {
    const personaId = await seedPersona('Sequential Claim Channel')
    const db = getTestDb()

    const firstClaim = await claimRegenerationLock(personaId, 300_000, db)
    expect(firstClaim).toBe(true)

    const secondClaim = await claimRegenerationLock(personaId, 300_000, db)
    expect(secondClaim).toBe(false)
  })

  it('a stale lock (older than budget) is reclaimable', async () => {
    const personaId = await seedPersona('Stale Lock Channel')
    const db = getTestDb()

    // Directly set regenerating_at to 301 seconds ago to simulate a stale lock
    await db.execute(sql`
      UPDATE personas
      SET regenerating_at = now() - interval '301 seconds'
      WHERE id = ${personaId}
    `)

    // The stale-lock predicate treats this as unclaimed - claim should succeed
    const claimed = await claimRegenerationLock(personaId, 300_000, db)
    expect(claimed).toBe(true)
  })

  it('release clears the lock', async () => {
    const personaId = await seedPersona('Release Lock Channel')
    const db = getTestDb()

    const claimed = await claimRegenerationLock(personaId, 300_000, db)
    expect(claimed).toBe(true)

    await releaseRegenerationLock(personaId, db)

    // After release, the lock should be claimable again
    const reclaimed = await claimRegenerationLock(personaId, 300_000, db)
    expect(reclaimed).toBe(true)
  })
})

describe('waitForRegenerationToClear', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  afterAll(async () => {
    await teardownTestDb()
  })

  it('returns the fresh row once the lock clears', async () => {
    const personaId = await seedPersona('Poll Join Channel')
    const db = getTestDb()

    // Owner claims the lock
    const claimed = await claimRegenerationLock(personaId, 300_000, db)
    expect(claimed).toBe(true)

    // Simulate the owner releasing mid-poll (after a short delay)
    const releaseDelay = 800 // ms - enough for the poller to see the locked state first
    setTimeout(async () => {
      // Update the row with fresh data then release the lock
      await db.execute(sql`
        UPDATE personas
        SET system_prompt = 'Updated system prompt',
            regenerating_at = NULL
        WHERE id = ${personaId}
      `)
    }, releaseDelay)

    // joiner polls until lock clears - use a 5s timeout
    const freshPersona = await waitForRegenerationToClear(personaId, 5_000, db)

    expect(freshPersona).toBeDefined()
    expect(freshPersona.id).toBe(personaId)
    // Lock column must be cleared on the returned row
    expect(freshPersona.regeneratingAt).toBeNull()
    // The fresh system prompt written by the "owner" must be visible
    expect(freshPersona.systemPrompt).toBe('Updated system prompt')
  })

  it('throws when timeout is exceeded before lock clears', async () => {
    const personaId = await seedPersona('Timeout Channel')
    const db = getTestDb()

    // Lock the row and never release it
    await claimRegenerationLock(personaId, 300_000, db)

    // Poll with a tight timeout - should throw before the lock clears
    await expect(
      waitForRegenerationToClear(personaId, 600, db)
    ).rejects.toThrow(/timed out/i)
  })
})
