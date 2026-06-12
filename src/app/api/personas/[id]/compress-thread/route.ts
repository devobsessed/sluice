import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db, personas } from '@/lib/db'
import { eq } from 'drizzle-orm'
import { startApiTimer } from '@/lib/api-timing'
import { requireSession } from '@/lib/auth-guards'
import { distillFacts } from '@/lib/personas/thread-compression'
import { MAX_FACTS } from '@/lib/personas/chat-storage'

const compressSchema = z.object({
  thread: z
    .array(z.object({ question: z.string(), answer: z.string() }))
    .max(50),
  existingFacts: z.array(z.string()).max(MAX_FACTS),
})

/**
 * POST /api/personas/[id]/compress-thread
 *
 * Stateless compute endpoint: distills a closing chat thread into 3-5
 * channel-topical facts via the server-side Haiku helper. Persists NOTHING
 * server-side - facts live only in the client's localStorage envelope.
 * Exists because the client-side hook cannot import the server-only Claude
 * client (see story amendment 2026-06-11).
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const denied = await requireSession()
  if (denied) return denied

  const timer = startApiTimer('/api/personas/[id]/compress-thread', 'POST')

  try {
    const { id } = await context.params

    // Validate ID is a number
    const personaId = parseInt(id, 10)
    if (isNaN(personaId)) {
      timer.end(400)
      return NextResponse.json({ error: 'Invalid persona ID' }, { status: 400 })
    }

    // Parse and validate request body
    let body
    try {
      body = await request.json()
    } catch {
      timer.end(400)
      return NextResponse.json({ error: 'Invalid JSON in request body' }, { status: 400 })
    }

    const validationResult = compressSchema.safeParse(body)
    if (!validationResult.success) {
      const firstError = validationResult.error.issues[0]
      timer.end(400)
      return NextResponse.json(
        { error: firstError?.message || 'Invalid request body' },
        { status: 400 }
      )
    }

    const { thread, existingFacts } = validationResult.data

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

    // Distill server-side; failure semantics live in distillFacts
    // (returns existingFacts unchanged on model failure/empty output)
    const facts = await distillFacts({
      thread,
      existingFacts,
      channelName: persona.channelName,
      signal: request.signal,
    })

    timer.end(200)
    return NextResponse.json({ facts })
  } catch (error) {
    console.error('Error compressing thread:', error)
    timer.end(500)
    return NextResponse.json(
      { error: 'Failed to compress thread. Please try again.' },
      { status: 500 }
    )
  }
}
