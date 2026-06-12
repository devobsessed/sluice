import { z } from 'zod'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  question: string
  answer: string
  timestamp: number
  isStreaming?: boolean
  isError?: boolean
}

/** Marker inserted by "New thread" action. Not a real message. */
export interface ThreadBoundary {
  type: 'thread-boundary'
  timestamp: number
}

export type ChatEntry = ChatMessage | ThreadBoundary

export function isThreadBoundary(entry: ChatEntry): entry is ThreadBoundary {
  return 'type' in entry && entry.type === 'thread-boundary'
}

export function isChatMessage(entry: ChatEntry): entry is ChatMessage {
  return !isThreadBoundary(entry)
}

/** v2 localStorage envelope - entries only (no facts). */
export interface ChatStorageV2 {
  version: 2
  entries: ChatEntry[]
}

/** v3 localStorage envelope - entries + remembered facts. */
export interface ChatStorageV3 {
  version: 3
  entries: ChatEntry[]
  facts: string[]
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STORAGE_KEY_PREFIX = 'persona-chat:'

/** Hard cap on remembered facts per persona. Newest-evicts-oldest when exceeded. */
export const MAX_FACTS = 5

export function storageKey(personaId: number): string {
  return `${STORAGE_KEY_PREFIX}${personaId}`
}

// ── Zod schema for server-side history validation ─────────────────────────────

export const historyItemSchema = z.object({
  question: z.string(),
  answer: z.string(),
})

export type HistoryItem = z.infer<typeof historyItemSchema>

export const historySchema = z.array(historyItemSchema).max(50)

// ── Migration ─────────────────────────────────────────────────────────────────

/**
 * Migrates v1 data (bare ChatMessage[]) to v3 format.
 * Inserts a thread boundary before old messages so they display
 * as "Earlier messages (no memory)" but are not sent as context.
 */
function migrateV1ToV3(messages: ChatMessage[]): ChatStorageV3 {
  if (messages.length === 0) {
    return { version: 3, entries: [], facts: [] }
  }
  // Insert boundary before legacy messages
  const boundary: ThreadBoundary = {
    type: 'thread-boundary',
    timestamp: messages[0]!.timestamp,
  }
  return {
    version: 3,
    entries: [boundary, ...messages],
    facts: [],
  }
}

// ── Load ──────────────────────────────────────────────────────────────────────

/**
 * Loads and migrates chat data for a persona from localStorage.
 * Returns v3 format regardless of stored version.
 * Migration ladder: v1 (bare array) -> v3, v2 ({version:2,entries}) -> v3.
 */
export function loadChatStorage(personaId: number): ChatStorageV3 {
  try {
    const raw = localStorage.getItem(storageKey(personaId))
    if (!raw) return { version: 3, entries: [], facts: [] }

    const parsed: unknown = JSON.parse(raw)

    if (typeof parsed === 'object' && parsed !== null && 'version' in parsed) {
      const versioned = parsed as { version: unknown }

      // v3 format: { version: 3, entries: [...], facts: [...] }
      if (versioned.version === 3) {
        return parsed as ChatStorageV3
      }

      // v2 format: { version: 2, entries: [...] } - migrate to v3
      if (versioned.version === 2) {
        const v2 = parsed as ChatStorageV2
        const migrated: ChatStorageV3 = {
          version: 3,
          entries: v2.entries,
          facts: [],
        }
        saveChatStorage(personaId, migrated)
        return migrated
      }
    }

    // v1 format: bare ChatMessage[] array
    if (Array.isArray(parsed)) {
      const migrated = migrateV1ToV3(parsed as ChatMessage[])
      // Persist migrated format immediately
      saveChatStorage(personaId, migrated)
      return migrated
    }

    return { version: 3, entries: [], facts: [] }
  } catch {
    return { version: 3, entries: [], facts: [] }
  }
}

// ── Save ──────────────────────────────────────────────────────────────────────

/**
 * Persists v3 chat data. Filters out streaming/error messages before saving.
 * Facts are explicitly persisted - they are NOT reconstructed and will not be dropped.
 */
export function saveChatStorage(personaId: number, data: ChatStorageV3): void {
  const cleaned: ChatEntry[] = data.entries
    .map((entry) => {
      if (isThreadBoundary(entry)) return entry
      // Strip streaming/error messages
      if (entry.isStreaming || entry.isError) return null
      // Clean message: remove transient flags
      return {
        question: entry.question,
        answer: entry.answer,
        timestamp: entry.timestamp,
      } as ChatMessage
    })
    .filter((e): e is ChatEntry => e !== null)

  try {
    localStorage.setItem(
      storageKey(personaId),
      JSON.stringify({ version: 3, entries: cleaned, facts: data.facts })
    )
  } catch {
    // Ignore quota exceeded
  }
}

// ── Context window extraction ─────────────────────────────────────────────────

const MAX_HISTORY_CHARS = 20000
const MAX_HISTORY_PAIRS = 50

/**
 * Extracts the active context window: completed Q&A pairs after the last
 * thread boundary, capped at 50 pairs and ~20000 chars total.
 */
export function getContextWindow(entries: ChatEntry[]): HistoryItem[] {
  // Find index of last thread boundary
  let boundaryIdx = -1
  for (let i = entries.length - 1; i >= 0; i--) {
    if (isThreadBoundary(entries[i]!)) {
      boundaryIdx = i
      break
    }
  }

  // Messages after the last boundary (or all if no boundary)
  const activeEntries = entries.slice(boundaryIdx + 1)

  // Filter to completed messages only
  const completed = activeEntries
    .filter(isChatMessage)
    .filter((m) => !m.isStreaming && !m.isError && m.answer.length > 0)

  // Take last N pairs, then cap by char count.
  // Iterate newest-to-oldest so the char cap drops OLDEST messages first
  // (preserving recent context). Reverse the result at the end so callers
  // receive history in chronological order.
  const recent = completed.slice(-MAX_HISTORY_PAIRS)

  const result: HistoryItem[] = []
  let totalChars = 0

  for (let i = recent.length - 1; i >= 0; i--) {
    const msg = recent[i]!
    const pairChars = msg.question.length + msg.answer.length
    if (totalChars + pairChars > MAX_HISTORY_CHARS && result.length > 0) {
      break
    }
    result.push({ question: msg.question, answer: msg.answer })
    totalChars += pairChars
  }

  return result.reverse()
}

// ── Helpers for hub ───────────────────────────────────────────────────────────

/**
 * Returns all persona IDs that have localStorage data.
 * Scans localStorage keys matching the prefix.
 */
export function getAllPersonaChatIds(): number[] {
  const ids: number[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(STORAGE_KEY_PREFIX)) {
        const idStr = key.slice(STORAGE_KEY_PREFIX.length)
        const id = parseInt(idStr, 10)
        if (!isNaN(id)) ids.push(id)
      }
    }
  } catch {
    // localStorage unavailable
  }
  return ids
}

/**
 * Returns the last ChatMessage from a persona's entries (skipping boundaries).
 * Used by the hub to show message preview and timestamp.
 */
export function getLastMessage(entries: ChatEntry[]): ChatMessage | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!
    if (isChatMessage(entry) && !entry.isError) return entry
  }
  return null
}

/**
 * Removes chat data for a persona from localStorage.
 */
export function clearChatStorage(personaId: number): void {
  try {
    localStorage.removeItem(storageKey(personaId))
  } catch {
    // localStorage unavailable
  }
}

// ── Fact mutation helpers ─────────────────────────────────────────────────────

/**
 * Appends new facts to the persona's stored fact list, enforcing the MAX_FACTS
 * hard cap by evicting the oldest facts first (newest-evicts-oldest).
 * Saves and returns the updated v3 envelope.
 */
export function addFactsToStorage(
  personaId: number,
  newFacts: string[]
): ChatStorageV3 {
  const storage = loadChatStorage(personaId)
  const merged = [...storage.facts, ...newFacts]
  const capped = merged.slice(-MAX_FACTS)
  const updated: ChatStorageV3 = { ...storage, facts: capped }
  saveChatStorage(personaId, updated)
  return updated
}

/**
 * Replaces the persona's stored facts with an already-merged set (e.g. the
 * reconciled result returned by the compress-thread endpoint, which has the
 * existing facts merged in server-side). Dedupes preserving first occurrence
 * and applies the MAX_FACTS cap as a backstop. Saves and returns the updated
 * v3 envelope. Use this - NOT addFactsToStorage - when the input set already
 * contains the existing facts, or they get double-merged into duplicates.
 */
export function replaceFacts(
  personaId: number,
  facts: string[]
): ChatStorageV3 {
  const storage = loadChatStorage(personaId)
  const deduped = [...new Set(facts)]
  const capped = deduped.slice(-MAX_FACTS)
  const updated: ChatStorageV3 = { ...storage, facts: capped }
  saveChatStorage(personaId, updated)
  return updated
}

/**
 * Removes a single fact by exact string match.
 * Saves and returns the updated v3 envelope.
 */
export function removeFact(personaId: number, fact: string): ChatStorageV3 {
  const storage = loadChatStorage(personaId)
  const updated: ChatStorageV3 = {
    ...storage,
    facts: storage.facts.filter((f) => f !== fact),
  }
  saveChatStorage(personaId, updated)
  return updated
}

/**
 * Clears all facts for a persona.
 * Saves and returns the updated v3 envelope.
 */
export function clearFacts(personaId: number): ChatStorageV3 {
  const storage = loadChatStorage(personaId)
  const updated: ChatStorageV3 = { ...storage, facts: [] }
  saveChatStorage(personaId, updated)
  return updated
}
