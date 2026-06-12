import { NextResponse } from 'next/server'
import { db, personas } from '@/lib/db'
import { eq } from 'drizzle-orm'
import { startApiTimer } from '@/lib/api-timing'
import { requireSession } from '@/lib/auth-guards'
import {
  regeneratePersonaSystemPrompt,
  claimRegenerationLock,
  releaseRegenerationLock,
  waitForRegenerationToClear,
} from '@/lib/personas/service'

/** Stale-lock threshold matches maxDuration so a dead owner's lock expires exactly when the budget does */
const REGEN_LOCK_STALE_MS = 300_000

/** Budget for the joiner to wait for the owner to finish (keep under maxDuration) */
const REGEN_WAIT_TIMEOUT_MS = 290_000

/**
 * POST /api/personas/[id]/regenerate
 *
 * Regenerates the v2 system prompt for an existing persona in place.
 * Preserves the persona's id and transcriptCount so localStorage chat history
 * (keyed by personaId) stays valid.
 *
 * Concurrency: at most one Claude call runs per persona at a time.
 * The winner claims the regenerating_at row lock and runs the generation.
 * Any concurrent caller that loses the claim poll-joins (waits for the owner to
 * finish) and returns the owner's fresh row - no 409 is surfaced to clients.
 *
 * Response: full Persona row including transcriptCount and lastRegeneratedAt so
 * the UI can render "Voice updated from N videos".
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const denied = await requireSession()
  if (denied) return denied

  const timer = startApiTimer('/api/personas/[id]/regenerate', 'POST')

  try {
    const { id } = await context.params

    // Validate ID is a number
    const personaId = parseInt(id, 10)
    if (isNaN(personaId)) {
      timer.end(400)
      return NextResponse.json({ error: 'Invalid persona ID' }, { status: 400 })
    }

    // Fetch persona from database
    const [persona] = await db
      .select()
      .from(personas)
      .where(eq(personas.id, personaId))
      .limit(1)

    if (!persona) {
      timer.end(404)
      return NextResponse.json({ error: 'Persona not found' }, { status: 404 })
    }

    // Attempt to claim the per-persona regeneration lock.
    // claimRegenerationLock issues a single atomic conditional UPDATE so
    // exactly one concurrent caller's claim succeeds (Postgres serialises it).
    const claimed = await claimRegenerationLock(personaId, REGEN_LOCK_STALE_MS)

    if (!claimed) {
      // Joiner path: another caller is already regenerating this persona.
      // Poll until the lock clears and return the owner's fresh row.
      const fresh = await waitForRegenerationToClear(personaId, REGEN_WAIT_TIMEOUT_MS)
      timer.end(200)
      return NextResponse.json(fresh)
    }

    // Owner path: we hold the lock - run generation inside try/finally so the
    // lock is always released even if Claude throws or the process is interrupted.
    try {
      const updated = await regeneratePersonaSystemPrompt(persona.channelName)
      timer.end(200)
      return NextResponse.json(updated)
    } finally {
      // Release unconditionally - on success this unblocks any joiners; on
      // failure the stale predicate covers process-death but releasing here
      // means joiners don't wait out the full 300s budget.
      await releaseRegenerationLock(personaId)
    }
  } catch (error) {
    console.error('Error regenerating persona:', error)
    timer.end(500)
    return NextResponse.json(
      { error: 'Failed to regenerate persona. Please try again.' },
      { status: 500 }
    )
  }
}

/**
 * Configure route segment for Vercel
 * maxDuration allows longer-running operations (requires Pro plan)
 */
export const maxDuration = 300
