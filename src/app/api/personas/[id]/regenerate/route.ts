import { NextResponse } from 'next/server'
import { db, personas } from '@/lib/db'
import { eq } from 'drizzle-orm'
import { startApiTimer } from '@/lib/api-timing'
import { requireSession } from '@/lib/auth-guards'
import { regeneratePersonaSystemPrompt } from '@/lib/personas/service'

/**
 * POST /api/personas/[id]/regenerate
 *
 * Regenerates the v2 system prompt for an existing persona in place.
 * Preserves the persona's id, expertiseEmbedding, and transcriptCount so
 * localStorage chat history (keyed by personaId) stays valid.
 *
 * Returns the updated persona on success.
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

    // Regenerate the v2 system prompt and update in place
    const updated = await regeneratePersonaSystemPrompt(persona.channelName)

    timer.end(200)
    return NextResponse.json(updated)
  } catch (error) {
    console.error('Error regenerating persona:', error)
    timer.end(500)
    return NextResponse.json(
      { error: 'Failed to regenerate persona. Please try again.' },
      { status: 500 }
    )
  }
}
