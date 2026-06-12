import type { Persona } from '@/lib/db/schema'
import type { SearchResult } from '@/lib/search/types'
import type { HistoryItem } from '@/lib/personas/chat-storage'
import { formatContextForPrompt } from './context'
import { streamMessages } from '@/lib/claude/client'

// ── Weak-retrieval thresholds (named consts; values tune during adversarial pass) ──
// These are NEVER emitted to the model as numbers - they gate which instruction text to use.

/** Minimum raw cosine similarity (vector leg) for a chunk to count as strong evidence.
 *
 * Calibrated 2026-06-11 during the adversarial matrix against the real corpus
 * (all-MiniLM-L6-v2). This model's cosine floor is HIGH - completely alien
 * queries score ~0.60 against a dense corpus, so the discriminating band is
 * narrow (~0.60-0.75). Observed evidence (persona 1, top channel cosine):
 *   dead-on specific  ("OpenClaw hire")          0.746  -> strong
 *   dead-on specific  ("5 levels of AI coding")  0.725  -> strong
 *   ambiguous on-domain ("what should I focus")  0.674  -> weak (soft signal + ask-back by design)
 *   off-domain specific (Kubernetes autoscaling) 0.671  -> weak (honest deflection)
 *   alien             (sourdough hydration)      0.599  -> weak
 * Re-calibrate if the embedding model changes. */
const WEAK_RETRIEVAL_MIN_SIMILARITY = 0.68

/** Minimum number of strong-evidence chunks (cosine >= MIN_SIMILARITY) to be considered non-weak.
 * Raw row count is NOT a signal: channel-scoped search fills to its limit for any
 * populated channel regardless of relevance. We count evidence, not rows. */
const WEAK_RETRIEVAL_MIN_STRONG = 2

/**
 * Estimates token count (rough approximation: 1 token ~ 4 characters)
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Limits context to fit within token budget (~3K tokens)
 */
function limitContextTokens(context: SearchResult[], maxTokens = 3000): SearchResult[] {
  const limited: SearchResult[] = []
  let totalTokens = 0

  for (const result of context) {
    const tokens = estimateTokens(result.content)
    if (totalTokens + tokens > maxTokens) {
      break
    }
    limited.push(result)
    totalTokens += tokens
  }

  return limited
}

/**
 * Evidence summary for the weak-retrieval gate, computed from RAW vector-leg
 * cosine similarities (`vectorSimilarity`) - NEVER the post-fusion `similarity`
 * field, which holds RRF rank scores (~0.016-0.03) after hybrid fusion.
 */
function retrievalEvidence(context: SearchResult[]): { topVectorSim: number; strongCount: number } {
  const cosines = context
    .map(r => r.vectorSimilarity)
    .filter((s): s is number => typeof s === 'number')
  const topVectorSim = cosines.length > 0 ? Math.max(...cosines) : 0
  const strongCount = cosines.filter(s => s >= WEAK_RETRIEVAL_MIN_SIMILARITY).length
  return { topVectorSim, strongCount }
}

/**
 * Computes whether retrieval is weak based on cosine EVIDENCE, not row count.
 * Weak when the best cosine is below the floor, or fewer than
 * WEAK_RETRIEVAL_MIN_STRONG chunks clear it. Results with no vector evidence
 * at all (keyword-only / degraded path) count as weak - conservative per the
 * locked "Weak Retrieval Must Announce Itself" principle.
 */
function isWeakRetrieval(context: SearchResult[]): boolean {
  if (context.length === 0) return false // zero-retrieval is its own branch
  const { topVectorSim, strongCount } = retrievalEvidence(context)
  return topVectorSim < WEAK_RETRIEVAL_MIN_SIMILARITY || strongCount < WEAK_RETRIEVAL_MIN_STRONG
}

/**
 * Builds the system param for persona chat.
 *
 * Includes:
 * - Persona document (always)
 * - Persona prompt rule: never name other creators in answer text (always)
 * - Citation instruction (when context is present)
 * - Zero-retrieval guard (when context is empty)
 * - Soft weak-retrieval / ask-back signal (when retrieval is weak but nonzero)
 * - Remembered user facts block (when facts are provided)
 *
 * Numeric threshold values are NEVER included in the emitted text.
 */
function buildSystemParam(persona: Persona, context: SearchResult[], facts?: string[]): string {
  return buildSystemCore(persona, context, { includeAskBack: true, facts })
}

/**
 * Builds the system param for MCP one-shot tool calls.
 *
 * Identical to buildSystemParam except ask-back is NEVER included.
 * One-shot tool calls need answers, not clarifying questions.
 *
 * Exported so the MCP path and the streaming chat path share one guard
 * implementation - they cannot drift.
 *
 * The [persona-guard] log line is also emitted here so the guard is
 * observable at run time regardless of which path fired it.
 */
export function buildSystemParamForMcp(persona: Persona, context: SearchResult[]): string {
  return buildSystemCore(persona, context, { includeAskBack: false })
}

/**
 * Core system param builder. Both buildSystemParam and buildSystemParamForMcp
 * delegate here to ensure a single guard implementation.
 */
function buildSystemCore(
  persona: Persona,
  context: SearchResult[],
  options: { includeAskBack: boolean; facts?: string[] }
): string {
  const parts: string[] = [persona.systemPrompt]

  // Persona prompt rule: never name other creators in answer text.
  // The handoff chip owns routing - in-voice naming creates two sources of truth that drift.
  // "This is outside what I cover" is the in-voice ceiling.
  parts.push(
    '\n\n---\n\n' +
    'IMPORTANT: Never name or reference other creators in your answers. ' +
    'If a question is outside what you cover, say "this is outside what I cover" in your own voice. ' +
    'The interface handles routing to other experts - you do not need to.'
  )

  // Guard observability: log which branch fires so a silently-broken guard is diagnosable.
  // Strong retrieval logs nothing (no noise in the happy path).
  if (context.length === 0) {
    console.debug('[persona-guard] zero-retrieval fired', { personaId: persona.id, channel: persona.channelName })
  } else if (isWeakRetrieval(context)) {
    const { topVectorSim, strongCount } = retrievalEvidence(context)
    console.debug(`[persona-guard] weak-retrieval fired rows=${context.length} topVectorSim=${topVectorSim.toFixed(3)} strongCount=${strongCount}`, { personaId: persona.id })
  }

  if (context.length === 0) {
    // Zero-retrieval guard: no content retrieved - persona must state plainly it has no coverage
    parts.push(
      '\n\n---\n\n' +
      'IMPORTANT: No content was retrieved from your videos for this question.\n' +
      'You have no coverage of this topic in your recorded content.\n' +
      'Be direct and state plainly, in your own voice, that you have not covered this topic in your videos.\n' +
      'Do NOT answer from general knowledge or fabricate coverage you do not have.'
    )
  } else {
    // Citation instruction (context blocks are numbered [1]..[n] by formatContextForPrompt)
    parts.push(
      '\n\n---\n\n' +
      'When you reference specific content from the context blocks, cite the passage number as [n] ' +
      '(e.g. [1], [2]) matching the numbered [n] blocks provided. ' +
      'Uncited answers are valid when you are speaking from general expertise rather than a specific passage.'
    )

    if (isWeakRetrieval(context) && options.includeAskBack) {
      // Soft weak-retrieval / ask-back signal: phrased as a nudge, never a bright line.
      // Only included for the streaming chat path - MCP one-shot calls need answers, not questions.
      parts.push(
        '\n\n' +
        'Note: The retrieved context appears limited for this question. ' +
        'Treat this as a soft signal to consider whether you have enough content to give a thorough answer, ' +
        'not a hard gate. ' +
        'If the question is ambiguous and the context does not clearly address it, ' +
        'you may ask ONE clarifying question to better understand what the person needs. ' +
        'Let the evidence guide whether to ask - not your character alone.'
      )
    }
  }

  // Remembered user facts: appended to system param (never user turns) to keep it cacheable.
  if (options.facts && options.facts.length > 0) {
    const factLines = options.facts.map(f => `- ${f}`).join('\n')
    parts.push(
      '\n\n---\n\n' +
      'What I know about you from our past conversations:\n' +
      factLines
    )
  }

  return parts.join('')
}

interface StreamPersonaResponseParams {
  persona: Persona
  question: string
  context: SearchResult[]
  history?: HistoryItem[]
  signal?: AbortSignal
  /** Remembered facts about the user - appended to the system param, never to user turns */
  facts?: string[]
}

/**
 * Streams a persona response using the messages API.
 *
 * Structure:
 * - system: persona document + retrieval guards + citation instruction
 * - messages: one user/assistant pair per history item, then the current question
 *   (latest user message carries the <context> block; prior turns do not)
 *
 * Returns a ReadableStream that emits SSE-formatted events compatible with ensemble.ts.
 */
export async function streamPersonaResponse(
  params: StreamPersonaResponseParams
): Promise<ReadableStream<Uint8Array>> {
  const { persona, question, context, history = [], signal, facts } = params

  const limitedContext = limitContextTokens(context)
  const formattedContext = formatContextForPrompt(limitedContext)

  // ── System param ──────────────────────────────────────────────────────────
  // Guard observability (zero/weak-retrieval logging) happens inside buildSystemParam.
  // Built from limitedContext so the guard assesses the same evidence the model
  // sees in <context> and the client receives in the sources event.
  // Facts are appended to system (not user turns) to stay cacheable.
  const system = buildSystemParam(persona, limitedContext, facts)

  // ── Messages array ────────────────────────────────────────────────────────
  // History items become 1:1 alternating user/assistant pairs.
  // The latest user message carries the <context> block + question.
  // Prior history user messages carry only the bare question text.
  type MsgParam = { role: 'user' | 'assistant'; content: string }
  const messages: MsgParam[] = []

  for (const item of history) {
    messages.push({ role: 'user', content: item.question })
    messages.push({ role: 'assistant', content: item.answer })
  }

  // Latest user message: context + question
  const latestContent = formattedContext
    ? `<context>\n${formattedContext}\n</context>\n\n${question}`
    : question

  messages.push({ role: 'user', content: latestContent })

  // ── Start the streaming request ────────────────────────────────────────────
  const stream = streamMessages({ system, messages, signal })

  const encoder = new TextEncoder()

  return new ReadableStream({
    async start(controller) {
      try {
        stream.on('streamEvent', (event) => {
          if (event.type === 'content_block_delta') {
            const sseData = `data: ${JSON.stringify(event)}\n\n`
            controller.enqueue(encoder.encode(sseData))
          }
        })

        // Wait for stream to complete
        await stream.finalMessage()

        // Emit sources event: chunks in the same order as the numbered [n] context blocks
        // so [n] resolves to chunks[n-1] on the client side.
        const sourcesEvent = {
          type: 'sources',
          chunks: limitedContext.map(c => ({
            chunkId: c.chunkId,
            content: c.content,
            videoTitle: c.videoTitle,
            startTime: c.startTime,
            youtubeId: c.youtubeId,
          })),
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(sourcesEvent)}\n\n`))

        // Emit done event last
        controller.enqueue(encoder.encode('data: {"type":"done"}\n\n'))
        controller.close()
      } catch (error) {
        controller.error(error)
      }
    },
  })
}
