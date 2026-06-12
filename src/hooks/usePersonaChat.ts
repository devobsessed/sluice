import { useState, useEffect, useRef, useCallback } from 'react'
import {
  loadChatStorage,
  saveChatStorage,
  clearChatStorage,
  replaceFacts,
  removeFact as removeFact_,
  clearFacts as clearFacts_,
  isChatMessage,
  isThreadBoundary,
  getContextWindow,
  type ChatMessage,
  type ChatEntry,
  type ChatStorageV3,
} from '@/lib/personas/chat-storage'

export type { ChatMessage, ChatEntry }
export { isChatMessage, isThreadBoundary }

export interface SourceChunk {
  chunkId: number
  content: string
  videoTitle: string
  startTime: number | null
  youtubeId: string | null
}

export interface HandoffTarget {
  personaId: number
  personaName: string
}

export interface PersonaChatState {
  /** All entries including thread boundaries */
  entries: ChatEntry[]
  /** Derived: only ChatMessage entries — backward-compat getter */
  messages: ChatMessage[]
  isStreaming: boolean
  error: string | null
}

interface UsePersonaChatReturn {
  state: PersonaChatState
  /** Transient sources from the latest turn's SSE stream. Null when no message sent yet
   * or when the current turn has not yet emitted a sources event.
   * Never persisted to localStorage — resets to null at the start of each sendMessage. */
  liveSources: SourceChunk[] | null
  /** Transient handoff target from the latest turn's SSE stream.
   * Populated when the route detected a better-matching persona.
   * Cleared at the start of the next sendMessage and on personaId change. */
  handoff: HandoffTarget | null
  /** Remembered facts for this persona from previous threads. */
  facts: string[]
  /** Set of boundary timestamps that had successful thread compression (transient, session-only).
   * A boundary with its timestamp in this set renders the memory marker in the drawer;
   * absence means compression failed or hasn't run yet. */
  rememberedBoundaries: Set<number>
  sendMessage: (question: string) => Promise<void>
  startNewThread: () => void
  clearHistory: () => void
  /** Removes a single remembered fact by exact string match. */
  removeFact: (fact: string) => void
  /** Clears all remembered facts for this persona. */
  clearFacts: () => void
}

/**
 * Derives PersonaChatState from a ChatStorageV3 object plus transient flags.
 */
function deriveState(
  storage: ChatStorageV3,
  isStreaming: boolean,
  error: string | null
): PersonaChatState {
  const messages = storage.entries.filter(isChatMessage)
  return {
    entries: storage.entries,
    messages,
    isStreaming,
    error,
  }
}

/**
 * Manages single-persona chat state: sending questions, parsing SSE streams,
 * accumulating text, and persisting Q&A history to localStorage.
 *
 * SSE format from POST /api/personas/[id]/query:
 *   data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"..."}}
 *   data: {"type":"handoff","personaId":2,"personaName":"Other Creator"}
 *   data: {"type":"done"}
 *
 * Uses versioned localStorage schema (v3) via chat-storage module.
 * v1/v2 data is automatically migrated to v3 on first load.
 *
 * State shape:
 * - `entries` — all ChatEntry items (messages + thread boundaries)
 * - `messages` — derived: only ChatMessage entries (backward-compat)
 * - `handoff` — transient: set when stream emits a handoff event; cleared on next send/persona change
 * - `facts` — remembered user facts for this persona (persisted per-persona in localStorage)
 * - `rememberedBoundaries` — transient Set of boundary timestamps with successful compression
 * - `startNewThread()` — inserts a ThreadBoundary, resets context window, fires compression
 * - `sendMessage()` — sends history + facts from active context window in POST body
 *
 * @param personaId - The persona to chat with
 * @param _channelName - Retained for API stability; the compress-thread endpoint
 *   derives the channel server-side from the persona row (client input not trusted)
 */
export function usePersonaChat(personaId: number, _channelName: string): UsePersonaChatReturn {
  const [storage, setStorage] = useState<ChatStorageV3>(() =>
    loadChatStorage(personaId)
  )
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [liveSources, setLiveSources] = useState<SourceChunk[] | null>(null)
  const [handoff, setHandoff] = useState<HandoffTarget | null>(null)
  // Transient set of boundary timestamps that received successful compression this session
  const [rememberedBoundaries, setRememberedBoundaries] = useState<Set<number>>(
    () => new Set<number>()
  )

  const abortControllerRef = useRef<AbortController | null>(null)

  // Reload storage when personaId changes; abort any in-flight request; clear transient state
  useEffect(() => {
    abortControllerRef.current?.abort()
    setStorage(loadChatStorage(personaId))
    setIsStreaming(false)
    setError(null)
    setLiveSources(null)
    setHandoff(null)
    setRememberedBoundaries(new Set<number>())
  }, [personaId])

  // Abort any in-flight request on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort()
    }
  }, [])

  const sendMessage = useCallback(
    async (question: string): Promise<void> => {
      // Abort any previous in-flight request
      abortControllerRef.current?.abort()

      const controller = new AbortController()
      abortControllerRef.current = controller

      // Reset transient sources and handoff at the start of each message — never persisted
      setLiveSources(null)
      setHandoff(null)

      // Capture the current storage (including facts) BEFORE appending the new message
      const currentStorage = loadChatStorage(personaId)
      const history = getContextWindow(currentStorage.entries)
      const facts = currentStorage.facts

      const newMessage: ChatMessage = {
        question,
        answer: '',
        timestamp: Date.now(),
        isStreaming: true,
        isError: false,
      }

      // Append the new message (streaming placeholder) and set global state
      setStorage((prev) => {
        const updated: ChatStorageV3 = {
          ...prev,
          entries: [...prev.entries, newMessage],
        }
        return updated
      })
      setIsStreaming(true)
      setError(null)

      try {
        const response = await fetch(`/api/personas/${personaId}/query`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question, history, facts }),
          signal: controller.signal,
        })

        if (!response.ok) {
          let errorMessage = 'Failed to query persona. Please try again.'
          try {
            const errorData = await response.json()
            if (errorData.error) {
              errorMessage = errorData.error
            }
          } catch {
            // Use default message if JSON parse fails
          }
          throw new Error(errorMessage)
        }

        const body = response.body
        if (!body) {
          throw new Error('Unable to reach the server. Check your connection.')
        }

        const reader = body.getReader()
        const decoder = new TextDecoder()

        try {
          while (true) {
            const { done, value } = await reader.read()

            if (done) break

            const chunk = decoder.decode(value, { stream: true })
            const lines = chunk.split('\n')

            for (const line of lines) {
              if (!line.startsWith('data:')) continue

              const dataStr = line.substring(5).trim()
              if (!dataStr) continue

              let event: unknown
              try {
                event = JSON.parse(dataStr)
              } catch {
                // Skip malformed JSON lines
                continue
              }

              if (
                typeof event !== 'object' ||
                event === null ||
                !('type' in event)
              ) {
                continue
              }

              const typedEvent = event as Record<string, unknown>

              if (typedEvent['type'] === 'content_block_delta') {
                const delta = typedEvent['delta']
                if (
                  typeof delta === 'object' &&
                  delta !== null &&
                  (delta as Record<string, unknown>)['type'] === 'text_delta'
                ) {
                  const text = (delta as Record<string, unknown>)['text']
                  if (typeof text === 'string') {
                    setStorage((prev) => {
                      const entries = prev.entries.map((entry, idx) =>
                        idx === prev.entries.length - 1 && isChatMessage(entry)
                          ? { ...entry, answer: entry.answer + text }
                          : entry
                      )
                      return { ...prev, entries }
                    })
                  }
                }
              } else if (typedEvent['type'] === 'sources') {
                // Capture transient sources for the live turn — never persisted to localStorage
                const rawChunks = typedEvent['chunks']
                if (Array.isArray(rawChunks)) {
                  setLiveSources(rawChunks as SourceChunk[])
                }
              } else if (typedEvent['type'] === 'handoff') {
                // Capture transient handoff target — cleared on next sendMessage / persona change
                const personaIdVal = typedEvent['personaId']
                const personaNameVal = typedEvent['personaName']
                if (typeof personaIdVal === 'number' && typeof personaNameVal === 'string') {
                  setHandoff({ personaId: personaIdVal, personaName: personaNameVal })
                }
              } else if (typedEvent['type'] === 'done') {
                // Finalize the message and persist to localStorage
                setStorage((prev) => {
                  const entries = prev.entries.map((entry, idx) =>
                    idx === prev.entries.length - 1 && isChatMessage(entry)
                      ? { ...entry, isStreaming: false }
                      : entry
                  )
                  const updated: ChatStorageV3 = { ...prev, entries }
                  saveChatStorage(personaId, updated)
                  return updated
                })
                setIsStreaming(false)
              }
              // Unknown event types: silently ignored (no case needed — they fall through)
            }
          }
        } finally {
          reader.releaseLock()
          // Ensure isStreaming is cleared if stream closed without done event
          setIsStreaming((prev) => (prev ? false : prev))
        }
      } catch (err) {
        // Ignore abort errors — they're intentional
        if (err instanceof Error && err.name === 'AbortError') {
          return
        }

        let errorMessage = 'An error occurred. Please try again.'
        if (err instanceof Error) {
          errorMessage = err.message
        }

        // Mark the last message as an error
        setStorage((prev) => {
          const entries = prev.entries.map((entry, idx) =>
            idx === prev.entries.length - 1 && isChatMessage(entry)
              ? { ...entry, isStreaming: false, isError: true }
              : entry
          )
          return { ...prev, entries }
        })
        setIsStreaming(false)
        setError(errorMessage)
      }
    },
    [personaId]
  )

  const startNewThread = useCallback(() => {
    // Capture the closing thread's context window BEFORE inserting the boundary.
    // The compression prompt needs the conversation that's ending.
    const closingStorage = loadChatStorage(personaId)
    const closingThread = getContextWindow(closingStorage.entries)
    const existingFacts = closingStorage.facts

    const boundary = {
      type: 'thread-boundary' as const,
      timestamp: Date.now(),
    }
    const boundaryTimestamp = boundary.timestamp

    // Insert boundary and save SYNCHRONOUSLY — compression never blocks this
    setStorage((prev) => {
      const updated: ChatStorageV3 = {
        ...prev,
        entries: [...prev.entries, boundary],
      }
      saveChatStorage(personaId, updated)
      return updated
    })

    // Fire compression in the background — never awaited, never blocks the boundary insert.
    // Distillation runs server-side (the model client can't live in the browser);
    // this endpoint is stateless compute — facts persist only in localStorage here.
    void (async () => {
      let newFacts: string[]
      try {
        const response = await fetch(`/api/personas/${personaId}/compress-thread`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ thread: closingThread, existingFacts }),
        })
        if (!response.ok) {
          // Failure path: leave facts untouched, no marker (absence = failure signal)
          return
        }
        const data: { facts?: unknown } = await response.json()
        if (!Array.isArray(data.facts)) return
        newFacts = data.facts.filter((f): f is string => typeof f === 'string')
      } catch {
        // Network/parse failure: leave facts untouched, no marker
        return
      }

      // Compression succeeded when the server returned a different fact set.
      // Compare by content: distillFacts returns existingFacts unchanged (same content)
      // on failure / empty output; a different set means compression was productive.
      const compressionSucceeded =
        JSON.stringify(newFacts) !== JSON.stringify(existingFacts)

      if (!compressionSucceeded) {
        // Failure path: leave facts untouched, no marker (absence = failure signal)
        return
      }

      // Write new facts to storage and update hook state.
      // REPLACE, don't append: the server's distillFacts already merged
      // existingFacts in - appending would double-merge into duplicates.
      const updated = replaceFacts(personaId, newFacts)
      setStorage(updated)

      // Signal the marker: add this boundary's timestamp to the remembered set
      setRememberedBoundaries((prev) => {
        const next = new Set(prev)
        next.add(boundaryTimestamp)
        return next
      })
    })()
  }, [personaId])

  const clearHistory = useCallback(() => {
    clearChatStorage(personaId)
    setStorage({ version: 3, entries: [], facts: [] })
    setIsStreaming(false)
    setError(null)
  }, [personaId])

  const removeFact = useCallback(
    (fact: string) => {
      const updated = removeFact_(personaId, fact)
      setStorage(updated)
    },
    [personaId]
  )

  const clearFacts = useCallback(() => {
    const updated = clearFacts_(personaId)
    setStorage(updated)
  }, [personaId])

  // Derive state from split state pieces
  const state = deriveState(storage, isStreaming, error)
  const facts = storage.facts

  return {
    state,
    liveSources,
    handoff,
    facts,
    rememberedBoundaries,
    sendMessage,
    startNewThread,
    clearHistory,
    removeFact,
    clearFacts,
  }
}
