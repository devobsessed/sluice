import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db, personas } from '@/lib/db'
import { eq } from 'drizzle-orm'
import { getPersonaContext } from '@/lib/personas/context'
import { streamPersonaResponse } from '@/lib/personas/streaming'
import { rewriteFollowUpQuery } from '@/lib/personas/query-rewrite'
import { startApiTimer } from '@/lib/api-timing'
import { requireSession } from '@/lib/auth-guards'
import { historySchema } from '@/lib/personas/chat-storage'

const querySchema = z.object({
  question: z.string().min(1, 'Question is required'),
  history: historySchema.optional(),
})

/**
 * POST /api/personas/[id]/query
 *
 * Queries a persona with streaming response.
 * - Validates persona ID and request body
 * - Fetches relevant context from the creator's content
 * - Streams response from Claude API with persona's voice
 *
 * Request body: { question: string }
 * Response: text/event-stream with SSE events
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireSession()
  if (denied) return denied
  const { id } = await params
  const timer = startApiTimer(`/api/personas/${id}/query`, 'POST')
  try {
    // Validate ID
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

    const validationResult = querySchema.safeParse(body)
    if (!validationResult.success) {
      const firstError = validationResult.error.issues[0]
      timer.end(400)
      return NextResponse.json(
        { error: firstError?.message || 'Invalid request body' },
        { status: 400 }
      )
    }

    const { question, history } = validationResult.data

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

    // Conditionally rewrite follow-up questions into standalone search queries.
    // The rewrite is retrieval-only: searchQuery goes to getPersonaContext while
    // the original question still drives streamPersonaResponse, history, and UI.
    const searchQuery = await rewriteFollowUpQuery({
      question,
      history: history ?? [],
      signal: request.signal,
    })

    // Get relevant context from the creator's content
    const context = await getPersonaContext(persona.channelName, searchQuery)

    // Stream response from Claude API
    const stream = await streamPersonaResponse({
      persona,
      question,
      context,
      history: history ?? [],
    })

    // Return streaming response with appropriate headers
    timer.end(200)
    return new Response(stream, {
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'connection': 'keep-alive',
      },
    })
  } catch (error) {
    console.error('Error in persona query:', error)
    timer.end(500)
    return NextResponse.json(
      { error: 'Failed to process query. Please try again.' },
      { status: 500 }
    )
  }
}

/**
 * Configure route segment for Vercel
 * maxDuration allows longer-running operations (requires Pro plan)
 */
export const maxDuration = 300
