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

/** Versioned localStorage envelope. */
export interface ChatStorageV2 {
  version: 2
  entries: ChatEntry[]
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STORAGE_KEY_PREFIX = 'persona-chat:'
const CURRENT_VERSION = 2

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
 * Migrates v1 data (bare ChatMessage[]) to v2 format.
 * Inserts a thread boundary before old messages so they display
 * as "Earlier messages (no memory)" but are not sent as context.
 */
function migrateV1ToV2(messages: ChatMessage[]): ChatStorageV2 {
  if (messages.length === 0) {
    return { version: CURRENT_VERSION, entries: [] }
  }
  // Insert boundary before legacy messages
  const boundary: ThreadBoundary = {
    type: 'thread-boundary',
    timestamp: messages[0]!.timestamp,
  }
  return {
    version: CURRENT_VERSION,
    entries: [boundary, ...messages],
  }
}

// ── Load ──────────────────────────────────────────────────────────────────────

/**
 * Loads and migrates chat data for a persona from localStorage.
 * Returns v2 format regardless of stored version.
 */
export function loadChatStorage(personaId: number): ChatStorageV2 {
  try {
    const raw = localStorage.getItem(storageKey(personaId))
    if (!raw) return { version: CURRENT_VERSION, entries: [] }

    const parsed: unknown = JSON.parse(raw)

    // v2 format: { version: 2, entries: [...] }
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'version' in parsed &&
      (parsed as { version: unknown }).version === 2
    ) {
      const data = parsed as ChatStorageV2
      return data
    }

    // v1 format: bare ChatMessage[] array
    if (Array.isArray(parsed)) {
      const migrated = migrateV1ToV2(parsed as ChatMessage[])
      // Persist migrated format immediately
      saveChatStorage(personaId, migrated)
      return migrated
    }

    return { version: CURRENT_VERSION, entries: [] }
  } catch {
    return { version: CURRENT_VERSION, entries: [] }
  }
}

// ── Save ──────────────────────────────────────────────────────────────────────

/**
 * Persists v2 chat data. Filters out streaming/error messages before saving.
 */
export function saveChatStorage(personaId: number, data: ChatStorageV2): void {
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
      JSON.stringify({ version: CURRENT_VERSION, entries: cleaned })
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

  // Take last N pairs, then cap by char count
  const recent = completed.slice(-MAX_HISTORY_PAIRS)

  const result: HistoryItem[] = []
  let totalChars = 0

  for (const msg of recent) {
    const pairChars = msg.question.length + msg.answer.length
    if (totalChars + pairChars > MAX_HISTORY_CHARS && result.length > 0) {
      break
    }
    result.push({ question: msg.question, answer: msg.answer })
    totalChars += pairChars
  }

  return result
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
