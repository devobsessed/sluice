import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db, personas } from '@/lib/db'
import { eq } from 'drizzle-orm'
import { getPersonaContext } from '@/lib/personas/context'
import { streamPersonaResponse } from '@/lib/personas/streaming'
import { rewriteFollowUpQuery } from '@/lib/personas/query-rewrite'
import { findBestPersonas } from '@/lib/personas/ensemble'
import { startApiTimer } from '@/lib/api-timing'
import { requireSession } from '@/lib/auth-guards'
import { historySchema } from '@/lib/personas/chat-storage'

const querySchema = z.object({
  question: z.string().trim().min(1, 'Question is required'),
  history: historySchema.optional(),
  /** Remembered facts about the user from previous threads (max 5, newest-evicts-oldest) */
  facts: z.array(z.string()).max(5).optional(),
})

/**
 * Tunable margin for cross-persona handoff routing.
 * Another persona's score must exceed the current persona's score by at least
 * this amount before a handoff event is emitted.
 *
 * Calibrated 2026-06-12 against real prod centroids (10 embedded personas,
 * probe receipts in .craft/analysis/handoff-margin-probe/): genuinely
 * out-of-domain questions produce margins 0.13-0.31 while legitimate
 * same-domain near-ties stay below 0.07 - nothing was observed between
 * 0.07 and 0.13. The original 0.15 bisected the out-of-domain band, making
 * the chip a phrasing-dependent coin flip (presented as "never fires" in
 * prod). 0.10 sits inside the empty separating band: it catches every
 * observed out-of-domain case and suppresses every observed near-tie.
 * Recalibrate from [persona-handoff] logs if the persona roster changes
 * character. Fix record: handoff-margin-collapse-at-threshold.
 */
const HANDOFF_MARGIN = 0.10

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

    const { question, history, facts } = validationResult.data

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

    // Fetch all personas for handoff routing.
    // findBestPersonas re-embeds the question; the re-embed cost is accepted
    // (single-user app, local FastEmbed). Do NOT thread the retrieval embedding
    // through getPersonaContext - it collides with sibling files.
    const allPersonas = await db.select().from(personas)

    // Conditionally rewrite follow-up questions into standalone search queries.
    // The rewrite is retrieval-only: searchQuery goes to getPersonaContext while
    // the original question still drives streamPersonaResponse, history, and UI.
    const searchQuery = await rewriteFollowUpQuery({
      question,
      history: history ?? [],
      signal: request.signal,
    })

    // Compute handoff routing in parallel with context retrieval.
    // findBestPersonas returns [] when no personas have embeddings or embed fails - safe default.
    const [context, handoffResults] = await Promise.all([
      getPersonaContext(persona.channelName, searchQuery),
      findBestPersonas(question, allPersonas, allPersonas.length),
    ])

    // Determine whether to emit a handoff event.
    // Emit iff: top match is a DIFFERENT persona AND its score exceeds
    // the current persona's score by at least HANDOFF_MARGIN.
    let handoff: { personaId: number; personaName: string } | undefined

    if (handoffResults.length > 0) {
      const topResult = handoffResults[0]!
      const currentResult = handoffResults.find(r => r.persona.id === personaId)

      // Skip handoff when the current persona was never scored (no expertiseEmbedding):
      // a fabricated 0 baseline would emit a handoff to any persona scoring >= margin.
      if (
        currentResult &&
        topResult.persona.id !== personaId &&
        topResult.score - currentResult.score >= HANDOFF_MARGIN
      ) {
        handoff = {
          personaId: topResult.persona.id,
          personaName: topResult.persona.name,
        }
      }

      // Margin observability - the 0.15->0.10 calibration had zero prod evidence
      // to work from; this keeps the next calibration honest. Mirrors [persona-guard].
      console.log(
        `[persona-handoff] current=${persona.name}(${currentResult ? currentResult.score.toFixed(4) : 'unscored'})` +
        ` top=${topResult.persona.name}(${topResult.score.toFixed(4)})` +
        ` margin=${currentResult ? (topResult.score - currentResult.score).toFixed(4) : 'n/a'}` +
        ` threshold=${HANDOFF_MARGIN} fired=${handoff !== undefined}`
      )
    }

    // Stream response from Claude API
    const answerStream = await streamPersonaResponse({
      persona,
      question,
      context,
      history: history ?? [],
      facts,
    })

    // Merge the optional handoff preamble with the answer stream.
    // The handoff event is emitted BEFORE the answer stream so the client
    // can surface the chip while the answer is still arriving.
    const encoder = new TextEncoder()
    const stream = handoff
      ? new ReadableStream<Uint8Array>({
          async start(controller) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: 'handoff', personaId: handoff.personaId, personaName: handoff.personaName })}\n\n`
              )
            )
            const reader = answerStream.getReader()
            try {
              while (true) {
                const { done, value } = await reader.read()
                if (done) break
                controller.enqueue(value)
              }
              controller.close()
            } catch (err) {
              controller.error(err)
            } finally {
              reader.releaseLock()
            }
          },
        })
      : answerStream

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
