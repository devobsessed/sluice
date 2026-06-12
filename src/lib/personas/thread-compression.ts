import { generateTextFast } from '@/lib/claude/client'
import { MAX_FACTS } from '@/lib/personas/chat-storage'
import type { HistoryItem } from '@/lib/personas/chat-storage'

// ── Tuning constants ──────────────────────────────────────────────────────────

/** Timeout for the distillation call in milliseconds.
 *  Background fire-and-forget; generous window for thread compression. */
const DISTILL_TIMEOUT_MS = 8000

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Strips bullet/numbering markers and trims whitespace from a single line.
 * Handles: "- fact", "• fact", "* fact", "1. fact", "1) fact"
 */
function stripMarker(line: string): string {
  return line
    .replace(/^[\s\-•*]+/, '')        // leading dashes, bullets, asterisks
    .replace(/^\d+[.)]\s*/, '')        // leading "1. " or "1) "
    .trim()
}

/**
 * Parses the raw model output into clean fact statements.
 * Returns an empty array if no non-empty statements survive parsing.
 */
function parseModelOutput(raw: string): string[] {
  return raw
    .split('\n')
    .map(stripMarker)
    .filter((line) => line.length > 0)
}

// ── Distillation prompt ───────────────────────────────────────────────────────

function buildDistillationPrompt(params: {
  thread: HistoryItem[]
  existingFacts: string[]
  channelName: string
}): string {
  const { thread, existingFacts, channelName } = params

  // Format the thread as a readable conversation excerpt
  const threadLines =
    thread.length > 0
      ? thread
          .map((item) => `User: ${item.question}\nAssistant: ${item.answer}`)
          .join('\n\n')
      : '(no conversation yet)'

  // Format existing facts for the model to reconcile against
  const existingFactsSection =
    existingFacts.length > 0
      ? `Current remembered facts:\n${existingFacts.map((f) => `- ${f}`).join('\n')}`
      : 'Current remembered facts: (none)'

  return (
    `You are a memory assistant for a chat persona based on the YouTube channel "${channelName}". ` +
    `Your job is to distill a conversation into a concise set of channel-topical user facts.\n\n` +
    `${existingFactsSection}\n\n` +
    `New conversation:\n${threadLines}\n\n` +
    `Task: Produce a merged, deduplicated, coherent list of 3-5 SHORT statements about this user ` +
    `that will help the persona respond more personally in future conversations.\n\n` +
    `Rules:\n` +
    `- Facts must be topical to the channel domain and tech/workflow context (e.g. "exploring advanced TypeScript patterns", not "prefers Python").\n` +
    `- When the new conversation contradicts an existing fact, the newer thread wins. ` +
    `Override the conflicting older fact rather than keeping both - do NOT let contradictory facts coexist.\n` +
    `- Merge and reconcile facts from both the existing list and the new conversation. ` +
    `Drop superseded, redundant, or out-of-domain facts.\n` +
    `- Each fact is a short statement (under 10 words), no hedging, no "the user..."\n` +
    `- Output ONLY the fact statements, one per line, no bullets, no numbering, no preamble.\n\n` +
    `Merged fact list:`
  )
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface DistillFactsParams {
  /** The Q&A pairs from the closing thread to distill. */
  thread: HistoryItem[]
  /** Existing remembered facts to reconcile against. */
  existingFacts: string[]
  /** Channel name for domain anchoring in the distillation prompt. */
  channelName: string
  /** Optional abort signal forwarded to generateTextFast. */
  signal?: AbortSignal
}

/**
 * Distills a closing thread into a merged, drift-resistant set of user facts.
 *
 * Calls generateTextFast with a reconciliation prompt that passes the existing
 * facts IN and instructs the model to return a merged, deduplicated,
 * contradiction-resolved set of 3-5 SHORT channel-topical statements.
 * The newer thread wins on any conflict (hardest constraint: memory drift).
 *
 * Parsed output is applied through the hard-cap-5 newest-evicts-oldest backstop
 * (MAX_FACTS from Chunk 1) so the stored set never exceeds 5.
 *
 * Fail-safe: returns existingFacts unchanged on null response or parse-empty
 * output - no marker will appear upstream, per the locked observability design.
 *
 * Never throws.
 */
export async function distillFacts(params: DistillFactsParams): Promise<string[]> {
  const { thread, existingFacts, channelName, signal } = params

  const prompt = buildDistillationPrompt({ thread, existingFacts, channelName })

  const raw = await generateTextFast(prompt, {
    timeoutMs: DISTILL_TIMEOUT_MS,
    signal,
  })

  // Failure path: null means timeout/abort/error - return existingFacts unchanged
  if (raw === null) {
    return existingFacts
  }

  const parsed = parseModelOutput(raw)

  // Parse-empty path: model returned unusable output - return existingFacts unchanged
  if (parsed.length === 0) {
    return existingFacts
  }

  // Apply the mechanical hard-cap backstop: newest-evicts-oldest
  // The distillation prompt already handles semantic dedup/reconciliation;
  // this slice is a purely mechanical safety net.
  return parsed.slice(-MAX_FACTS)
}
