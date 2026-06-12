import { generateTextFast } from '@/lib/claude/client'
import type { HistoryItem } from '@/lib/personas/chat-storage'

// ── Tuning constants ───────────────────────────────────────────────────────────
// Conservative bias: false-positive rewrites (rewrote a standalone question) are
// worse than false-negative misses (missed follow-up = today's behavior).
// Move these thresholds here when precision tuning after dev log review.

/** Word count at-or-below which a question is considered "genuinely short"
 *  and likely elliptical when history exists. */
const SHORT_WORD_COUNT = 4

/** Timeout for the Haiku rewrite call in milliseconds.
 *  Graceful fallback to the raw question on timeout. */
const REWRITE_TIMEOUT_MS = 2000

/** Deixis/pronoun markers that signal a follow-up reference.
 *  Tested case-insensitively on word boundaries. */
const FOLLOWUP_MARKERS: RegExp[] = [
  /\bthat\b/,
  /\bit\b/,
  /\bthis\b/,
  /\bthese\b/,
  /\bthose\b/,
  /\bthem\b/,
  /\bthe\s+(first|second|third|fourth|fifth|last)\s+one\b/,
  /\byou\s+mentioned\b/,
  /\byou\s+said\b/,
  /\bearlier\b/,
  /^and\b/,
  /^but\b/,
  /^what\s+about\b/,
  /^how\s+about\b/,
]

// ── Core heuristic ────────────────────────────────────────────────────────────

/**
 * Pure follow-up detector - no LLM, no side effects.
 *
 * Returns false immediately when history is empty (first question): this
 * short-circuit guarantees zero latency tax on the common case.
 *
 * Otherwise fires only on actual follow-up signal: a deixis/pronoun marker
 * matched on word boundaries OR a genuinely short question. Never fires merely
 * because history exists (conservative bias - false positives are harmful).
 */
export function detectFollowUp(question: string, history: HistoryItem[]): boolean {
  // First-question short-circuit: zero latency tax on the common case.
  if (history.length === 0) return false

  const lower = question.toLowerCase()

  // Marker match: deixis/pronoun/conjunction on word boundary
  for (const marker of FOLLOWUP_MARKERS) {
    if (marker.test(lower)) return true
  }

  // Short-length signal: very short question with history is likely elliptical
  const wordCount = question.trim().split(/\s+/).length
  if (wordCount <= SHORT_WORD_COUNT) return true

  return false
}

// ── Rewrite orchestration ─────────────────────────────────────────────────────

/**
 * Conditionally rewrites a follow-up question into a standalone search query.
 *
 * When the heuristic fires and the Haiku rewrite succeeds within budget, returns
 * the rewritten string (used ONLY for retrieval; the caller passes the original
 * question to streamPersonaResponse/history/UI).
 *
 * Returns the original question unchanged on every non-trigger and failure path:
 * - heuristic does not fire (first question or clearly standalone)
 * - generateTextFast returns null (timeout / abort / error)
 * - rewrite is empty or whitespace
 *
 * Never throws.
 */
export async function rewriteFollowUpQuery(params: {
  question: string
  history: HistoryItem[]
  signal?: AbortSignal
}): Promise<string> {
  const { question, history, signal } = params

  if (!detectFollowUp(question, history)) {
    if (process.env.NODE_ENV !== 'production') {
      console.debug('[query-rewrite] path=raw (heuristic did not fire)', { question })
    }
    return question
  }

  // Bind the rewrite context to the last 2 exchanges ONLY - never the full
  // context window. This bounds stale-history pollution even on a false-positive
  // trigger (conductor's miscalibration bound).
  const contextExchanges = history.slice(-2)
  const contextLines = contextExchanges
    .map(item => `User: ${item.question}\nAssistant: ${item.answer}`)
    .join('\n')

  const rewritePrompt =
    `You are a search query rewriter. Given a conversation excerpt and a follow-up question, ` +
    `output ONLY a single standalone search query that captures what the user is asking about. ` +
    `No preamble, no explanation, no quotes - just the query.\n\n` +
    `Conversation:\n${contextLines}\n\n` +
    `Follow-up question: ${question}\n\n` +
    `Standalone search query:`

  const rewritten = await generateTextFast(rewritePrompt, {
    timeoutMs: REWRITE_TIMEOUT_MS,
    signal,
  })

  // Defensive cleanup: strip surrounding quotes or a "Query:" prefix that a
  // model might emit despite the prompt instructions.
  const cleaned = rewritten
    ?.trim()
    .replace(/^["']|["']$/g, '')
    .replace(/^Query:\s*/i, '')
    .trim()

  if (!cleaned) {
    if (process.env.NODE_ENV !== 'production') {
      console.debug('[query-rewrite] path=raw (rewrite empty/null - fallback)', { question })
    }
    return question
  }

  if (process.env.NODE_ENV !== 'production') {
    console.debug('[query-rewrite] path=rewrite', { original: question, rewritten: cleaned })
  }

  return cleaned
}
