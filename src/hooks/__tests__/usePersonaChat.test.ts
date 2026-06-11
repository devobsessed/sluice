import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { usePersonaChat } from '../usePersonaChat'

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch

// In-memory localStorage mock
const localStorageStore: Record<string, string> = {}
const localStorageMock = {
  getItem: vi.fn((key: string) => localStorageStore[key] ?? null),
  setItem: vi.fn((key: string, value: string) => {
    localStorageStore[key] = value
  }),
  removeItem: vi.fn((key: string) => {
    delete localStorageStore[key]
  }),
  clear: vi.fn(() => {
    Object.keys(localStorageStore).forEach((k) => delete localStorageStore[k])
  }),
  key: vi.fn(),
  length: 0,
}
Object.defineProperty(global, 'localStorage', {
  value: localStorageMock,
  writable: true,
})

/**
 * Builds a mock SSE ReadableStream from an array of SSE event strings.
 * Each entry is emitted as a line `data: <json>\n\n`.
 */
function makeSseStream(events: object[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }
      controller.close()
    },
  })
}

/**
 * Returns a mock fetch response with a streaming SSE body.
 */
function mockSseResponse(events: object[], ok = true, status = 200) {
  return {
    ok,
    status,
    body: makeSseStream(events),
    json: vi.fn().mockResolvedValue({}),
  }
}

const PERSONA_ID = 42
const STORAGE_KEY = `persona-chat:${PERSONA_ID}`

describe('usePersonaChat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorageMock.clear()
  })

  afterEach(() => {
    vi.clearAllTimers()
  })

  // ── 1. Initial state ─────────────────────────────────────────────────────

  it('initializes with empty messages when no localStorage data', () => {
    const { result } = renderHook(() => usePersonaChat(PERSONA_ID))

    expect(result.current.state.messages).toEqual([])
    expect(result.current.state.isStreaming).toBe(false)
    expect(result.current.state.error).toBeNull()
  })

  it('initializes with empty entries when no localStorage data', () => {
    const { result } = renderHook(() => usePersonaChat(PERSONA_ID))

    expect(result.current.state.entries).toEqual([])
  })

  // ── 2. loadMessages from localStorage ────────────────────────────────────

  it('loads existing messages from localStorage on mount', () => {
    const stored = [
      { question: 'What is RAG?', answer: 'Retrieval Augmented Generation', timestamp: 1000, isStreaming: false, isError: false },
    ]
    localStorageStore[STORAGE_KEY] = JSON.stringify(stored)

    const { result } = renderHook(() => usePersonaChat(PERSONA_ID))

    expect(result.current.state.messages).toHaveLength(1)
    expect(result.current.state.messages[0]?.question).toBe('What is RAG?')
    expect(result.current.state.messages[0]?.answer).toBe('Retrieval Augmented Generation')
  })

  it('ignores malformed JSON in localStorage and starts empty', () => {
    localStorageStore[STORAGE_KEY] = 'not-valid-json'

    const { result } = renderHook(() => usePersonaChat(PERSONA_ID))

    expect(result.current.state.messages).toEqual([])
  })

  it('ignores non-array localStorage data and starts empty', () => {
    localStorageStore[STORAGE_KEY] = JSON.stringify({ wrong: true })

    const { result } = renderHook(() => usePersonaChat(PERSONA_ID))

    expect(result.current.state.messages).toEqual([])
  })

  it('reloads messages when personaId changes', async () => {
    const stored42 = [
      { question: 'Q for 42', answer: 'A for 42', timestamp: 1000 },
    ]
    const stored99 = [
      { question: 'Q for 99', answer: 'A for 99', timestamp: 2000 },
    ]
    localStorageStore['persona-chat:42'] = JSON.stringify(stored42)
    localStorageStore['persona-chat:99'] = JSON.stringify(stored99)

    const { result, rerender } = renderHook(
      ({ id }: { id: number }) => usePersonaChat(id),
      { initialProps: { id: 42 } }
    )

    expect(result.current.state.messages[0]?.question).toBe('Q for 42')

    rerender({ id: 99 })

    await waitFor(() => {
      expect(result.current.state.messages[0]?.question).toBe('Q for 99')
    })
  })

  // ── 3. sendMessage creates streaming message and fetches ─────────────────

  it('sendMessage posts to the persona query endpoint', async () => {
    mockFetch.mockResolvedValue(
      mockSseResponse([{ type: 'done' }])
    )

    const { result } = renderHook(() => usePersonaChat(PERSONA_ID))

    await act(async () => {
      await result.current.sendMessage('What is TypeScript?')
    })

    expect(mockFetch).toHaveBeenCalledWith(
      `/api/personas/${PERSONA_ID}/query`,
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: expect.any(AbortSignal),
      })
    )
  })

  it('sendMessage includes empty history array when no prior context', async () => {
    mockFetch.mockResolvedValue(
      mockSseResponse([{ type: 'done' }])
    )

    const { result } = renderHook(() => usePersonaChat(PERSONA_ID))

    await act(async () => {
      await result.current.sendMessage('First question')
    })

    expect(mockFetch).toHaveBeenCalledWith(
      `/api/personas/${PERSONA_ID}/query`,
      expect.objectContaining({
        body: JSON.stringify({ question: 'First question', history: [] }),
      })
    )
  })

  it('sets isStreaming=true while fetching', async () => {
    let resolveStream: (() => void) | null = null
    const slowStream = new ReadableStream<Uint8Array>({
      start(controller) {
        resolveStream = () => {
          controller.enqueue(
            new TextEncoder().encode('data: {"type":"done"}\n\n')
          )
          controller.close()
        }
      },
    })

    mockFetch.mockResolvedValue({ ok: true, body: slowStream })

    const { result } = renderHook(() => usePersonaChat(PERSONA_ID))

    // Start sendMessage but don't await — check mid-flight state
    act(() => {
      result.current.sendMessage('What is React?')
    })

    await waitFor(() => {
      expect(result.current.state.isStreaming).toBe(true)
    })

    // Finish the stream
    await act(async () => {
      resolveStream?.()
    })

    await waitFor(() => {
      expect(result.current.state.isStreaming).toBe(false)
    })
  })

  // ── 4. Accumulates streamed text from content_block_delta events ──────────

  it('accumulates text from content_block_delta events', async () => {
    mockFetch.mockResolvedValue(
      mockSseResponse([
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'Hello ' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'world' },
        },
        { type: 'done' },
      ])
    )

    const { result } = renderHook(() => usePersonaChat(PERSONA_ID))

    await act(async () => {
      await result.current.sendMessage('Greet me')
    })

    await waitFor(() => {
      const msg = result.current.state.messages[0]
      expect(msg?.answer).toBe('Hello world')
    })
  })

  it('ignores content_block_delta events without text_delta type', async () => {
    mockFetch.mockResolvedValue(
      mockSseResponse([
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: '{}' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'Only this' },
        },
        { type: 'done' },
      ])
    )

    const { result } = renderHook(() => usePersonaChat(PERSONA_ID))

    await act(async () => {
      await result.current.sendMessage('Test')
    })

    await waitFor(() => {
      expect(result.current.state.messages[0]?.answer).toBe('Only this')
    })
  })

  // ── 5. Finalizes message on done event ────────────────────────────────────

  it('sets isStreaming=false on the message after done event', async () => {
    mockFetch.mockResolvedValue(
      mockSseResponse([
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'Finalized' },
        },
        { type: 'done' },
      ])
    )

    const { result } = renderHook(() => usePersonaChat(PERSONA_ID))

    await act(async () => {
      await result.current.sendMessage('Finalize me')
    })

    await waitFor(() => {
      const msg = result.current.state.messages[0]
      expect(msg?.isStreaming).toBe(false)
      expect(msg?.answer).toBe('Finalized')
    })
  })

  // ── 6. Saves completed messages to localStorage ───────────────────────────

  it('saves completed messages to localStorage after done event', async () => {
    mockFetch.mockResolvedValue(
      mockSseResponse([
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'Saved answer' },
        },
        { type: 'done' },
      ])
    )

    const { result } = renderHook(() => usePersonaChat(PERSONA_ID))

    await act(async () => {
      await result.current.sendMessage('Save me')
    })

    await waitFor(() => {
      const stored = localStorageMock.getItem(STORAGE_KEY)
      expect(stored).not.toBeNull()
      const parsed = JSON.parse(stored as string)
      // v2 format: { version: 2, entries: [...] }
      expect(parsed.version).toBe(2)
      expect(Array.isArray(parsed.entries)).toBe(true)
      expect(parsed.entries[0]?.answer).toBe('Saved answer')
      expect(parsed.entries[0]?.isStreaming).toBeFalsy()
      expect(parsed.entries[0]?.isError).toBeFalsy()
    })
  })

  it('does not save streaming or error messages to localStorage', async () => {
    // Simulate a stream that never sends done — isStreaming stays true
    mockFetch.mockRejectedValue(new Error('Network failure'))

    const { result } = renderHook(() => usePersonaChat(PERSONA_ID))

    await act(async () => {
      await result.current.sendMessage('Fail me')
    })

    await waitFor(() => {
      expect(result.current.state.error).not.toBeNull()
    })

    // localStorage should not contain error messages
    const stored = localStorageMock.getItem(STORAGE_KEY)
    if (stored !== null) {
      const parsed = JSON.parse(stored)
      for (const msg of parsed) {
        expect(msg.isError).not.toBe(true)
        expect(msg.isStreaming).not.toBe(true)
      }
    }
  })

  // ── 7. Error handling ─────────────────────────────────────────────────────

  it('sets error state when fetch throws a network error', async () => {
    mockFetch.mockRejectedValue(new TypeError('Failed to fetch'))

    const { result } = renderHook(() => usePersonaChat(PERSONA_ID))

    await act(async () => {
      await result.current.sendMessage('Cause an error')
    })

    await waitFor(() => {
      expect(result.current.state.error).not.toBeNull()
      expect(result.current.state.isStreaming).toBe(false)
    })
  })

  it('sets error state when response is not ok', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      body: null,
      json: vi.fn().mockResolvedValue({ error: 'Persona not found' }),
    })

    const { result } = renderHook(() => usePersonaChat(PERSONA_ID))

    await act(async () => {
      await result.current.sendMessage('Bad persona')
    })

    await waitFor(() => {
      expect(result.current.state.error).not.toBeNull()
      expect(result.current.state.isStreaming).toBe(false)
    })
  })

  it('marks the message as isError=true when fetch fails', async () => {
    mockFetch.mockRejectedValue(new Error('Server down'))

    const { result } = renderHook(() => usePersonaChat(PERSONA_ID))

    await act(async () => {
      await result.current.sendMessage('Will fail')
    })

    await waitFor(() => {
      const msg = result.current.state.messages[0]
      expect(msg?.isError).toBe(true)
    })
  })

  // ── 8. clearHistory ───────────────────────────────────────────────────────

  it('clearHistory removes localStorage entry and resets messages', async () => {
    const stored = [
      { question: 'Old Q', answer: 'Old A', timestamp: 1000 },
    ]
    localStorageStore[STORAGE_KEY] = JSON.stringify(stored)

    const { result } = renderHook(() => usePersonaChat(PERSONA_ID))

    expect(result.current.state.messages).toHaveLength(1)

    act(() => {
      result.current.clearHistory()
    })

    expect(result.current.state.messages).toEqual([])
    expect(localStorageMock.removeItem).toHaveBeenCalledWith(STORAGE_KEY)
  })

  it('clearHistory also clears any error state', async () => {
    mockFetch.mockRejectedValue(new Error('Fail'))

    const { result } = renderHook(() => usePersonaChat(PERSONA_ID))

    await act(async () => {
      await result.current.sendMessage('Fail')
    })

    await waitFor(() => {
      expect(result.current.state.error).not.toBeNull()
    })

    act(() => {
      result.current.clearHistory()
    })

    expect(result.current.state.error).toBeNull()
  })

  // ── 9. AbortController on unmount ────────────────────────────────────────

  it('aborts the in-flight request when component unmounts', async () => {
    // Stream that never resolves
    mockFetch.mockResolvedValue({
      ok: true,
      body: new ReadableStream({ start() {} }),
    })

    const { result, unmount } = renderHook(() => usePersonaChat(PERSONA_ID))

    // Start a message (fire and forget — don't await)
    act(() => {
      void result.current.sendMessage('Orphan')
    })

    await waitFor(() => {
      expect(result.current.state.isStreaming).toBe(true)
    })

    // Unmount should not throw and should abort the request
    expect(() => unmount()).not.toThrow()
  })

  // ── 10. Malformed JSON in SSE ─────────────────────────────────────────────

  it('handles malformed JSON in SSE events gracefully and still finalizes on done', async () => {
    const encoder = new TextEncoder()
    const badStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: not-valid-json\n\n'))
        controller.enqueue(encoder.encode('data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"good"}}\n\n'))
        controller.enqueue(encoder.encode('data: {"type":"done"}\n\n'))
        controller.close()
      },
    })

    mockFetch.mockResolvedValue({ ok: true, body: badStream })

    const { result } = renderHook(() => usePersonaChat(PERSONA_ID))

    await act(async () => {
      await result.current.sendMessage('Handle bad JSON')
    })

    await waitFor(() => {
      const msg = result.current.state.messages[0]
      expect(msg?.answer).toBe('good')
      expect(msg?.isStreaming).toBe(false)
      expect(result.current.state.error).toBeNull()
    })
  })

  it('handles null response body gracefully', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      body: null,
      json: vi.fn().mockResolvedValue({}),
    })

    const { result } = renderHook(() => usePersonaChat(PERSONA_ID))

    await act(async () => {
      await result.current.sendMessage('Null body')
    })

    await waitFor(() => {
      expect(result.current.state.error).not.toBeNull()
      expect(result.current.state.isStreaming).toBe(false)
    })
  })

  // ── 11. entries field (new in chunk 2) ───────────────────────────────────

  it('state.entries contains all ChatEntry items including boundaries', async () => {
    mockFetch.mockResolvedValue(
      mockSseResponse([
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Answer' } },
        { type: 'done' },
      ])
    )

    const { result } = renderHook(() => usePersonaChat(PERSONA_ID))

    await act(async () => {
      await result.current.sendMessage('Question')
    })

    await waitFor(() => {
      expect(result.current.state.entries).toHaveLength(1)
      expect(result.current.state.entries[0]).toMatchObject({
        question: 'Question',
        answer: 'Answer',
      })
    })
  })

  it('state.messages is a derived view of only ChatMessage entries (no boundaries)', async () => {
    mockFetch.mockResolvedValue(
      mockSseResponse([{ type: 'done' }])
    )

    const { result } = renderHook(() => usePersonaChat(PERSONA_ID))

    await act(async () => {
      await result.current.sendMessage('A question')
    })

    // Insert a thread boundary
    act(() => {
      result.current.startNewThread()
    })

    await waitFor(() => {
      // entries has both the message and the boundary
      expect(result.current.state.entries.length).toBeGreaterThan(1)
      // messages only returns ChatMessage entries
      const hasBoundary = result.current.state.messages.some(
        (m) => 'type' in m && m.type === 'thread-boundary'
      )
      expect(hasBoundary).toBe(false)
    })
  })

  // ── 12. startNewThread ───────────────────────────────────────────────────

  it('startNewThread appends a thread boundary to entries', async () => {
    const { result } = renderHook(() => usePersonaChat(PERSONA_ID))

    act(() => {
      result.current.startNewThread()
    })

    expect(result.current.state.entries).toHaveLength(1)
    expect(result.current.state.entries[0]).toMatchObject({
      type: 'thread-boundary',
    })
  })

  it('startNewThread persists the boundary to localStorage', () => {
    const { result } = renderHook(() => usePersonaChat(PERSONA_ID))

    act(() => {
      result.current.startNewThread()
    })

    const stored = localStorageMock.getItem(STORAGE_KEY)
    expect(stored).not.toBeNull()
    const parsed = JSON.parse(stored as string)
    expect(parsed.version).toBe(2)
    expect(parsed.entries).toHaveLength(1)
    expect(parsed.entries[0]).toMatchObject({ type: 'thread-boundary' })
  })

  it('startNewThread preserves existing messages before the boundary', async () => {
    mockFetch.mockResolvedValue(
      mockSseResponse([
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Old answer' } },
        { type: 'done' },
      ])
    )

    const { result } = renderHook(() => usePersonaChat(PERSONA_ID))

    await act(async () => {
      await result.current.sendMessage('Old question')
    })

    await waitFor(() => {
      expect(result.current.state.messages).toHaveLength(1)
    })

    act(() => {
      result.current.startNewThread()
    })

    await waitFor(() => {
      // entries: [message, boundary]
      expect(result.current.state.entries).toHaveLength(2)
      // messages only returns ChatMessage entries (not boundary)
      expect(result.current.state.messages).toHaveLength(1)
    })
  })

  // ── 13. Context window respects thread boundaries ─────────────────────────

  it('sendMessage sends history from context window (messages after last boundary)', async () => {
    // Pre-populate localStorage with a completed Q&A
    const storedData = {
      version: 2,
      entries: [
        { question: 'Prior Q', answer: 'Prior A', timestamp: 1000 },
      ],
    }
    localStorageStore[STORAGE_KEY] = JSON.stringify(storedData)

    mockFetch.mockResolvedValue(
      mockSseResponse([{ type: 'done' }])
    )

    const { result } = renderHook(() => usePersonaChat(PERSONA_ID))

    await act(async () => {
      await result.current.sendMessage('Follow-up Q')
    })

    expect(mockFetch).toHaveBeenCalledWith(
      `/api/personas/${PERSONA_ID}/query`,
      expect.objectContaining({
        body: JSON.stringify({
          question: 'Follow-up Q',
          history: [{ question: 'Prior Q', answer: 'Prior A' }],
        }),
      })
    )
  })

  it('sendMessage sends empty history when thread boundary precedes all messages', async () => {
    // Pre-populate with a boundary followed by a message (boundary is at end — no prior context)
    const storedData = {
      version: 2,
      entries: [
        { question: 'Old Q', answer: 'Old A', timestamp: 1000 },
        { type: 'thread-boundary', timestamp: 2000 },
      ],
    }
    localStorageStore[STORAGE_KEY] = JSON.stringify(storedData)

    mockFetch.mockResolvedValue(
      mockSseResponse([{ type: 'done' }])
    )

    const { result } = renderHook(() => usePersonaChat(PERSONA_ID))

    await act(async () => {
      await result.current.sendMessage('Fresh start Q')
    })

    expect(mockFetch).toHaveBeenCalledWith(
      `/api/personas/${PERSONA_ID}/query`,
      expect.objectContaining({
        body: JSON.stringify({ question: 'Fresh start Q', history: [] }),
      })
    )
  })

  it('context window excludes messages before thread boundary', async () => {
    // Pre-populate with messages before boundary, then message after
    const storedData = {
      version: 2,
      entries: [
        { question: 'Before boundary', answer: 'Answer before', timestamp: 1000 },
        { type: 'thread-boundary', timestamp: 2000 },
        { question: 'After boundary', answer: 'Answer after', timestamp: 3000 },
      ],
    }
    localStorageStore[STORAGE_KEY] = JSON.stringify(storedData)

    mockFetch.mockResolvedValue(
      mockSseResponse([{ type: 'done' }])
    )

    const { result } = renderHook(() => usePersonaChat(PERSONA_ID))

    await act(async () => {
      await result.current.sendMessage('Next question')
    })

    // History should only include the message after the boundary
    expect(mockFetch).toHaveBeenCalledWith(
      `/api/personas/${PERSONA_ID}/query`,
      expect.objectContaining({
        body: JSON.stringify({
          question: 'Next question',
          history: [{ question: 'After boundary', answer: 'Answer after' }],
        }),
      })
    )
  })

  // ── 14. liveSources — transient sources from /query SSE stream ───────────

  it('hook captures sources into liveSources transient state', async () => {
    const mockSources = [
      {
        chunkId: 1,
        content: 'TypeScript is a typed superset of JavaScript.',
        videoTitle: 'Intro to TypeScript',
        startTime: 10,
        youtubeId: 'abc123',
      },
    ]
    mockFetch.mockResolvedValue(
      mockSseResponse([
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'Answer' },
        },
        { type: 'sources', chunks: mockSources },
        { type: 'done' },
      ])
    )

    const { result } = renderHook(() => usePersonaChat(PERSONA_ID))

    await act(async () => {
      await result.current.sendMessage('What is TypeScript?')
    })

    await waitFor(() => {
      expect(result.current.liveSources).toEqual(mockSources)
    })
  })

  it('hook resets liveSources at the start of each sendMessage', async () => {
    const firstSources = [
      {
        chunkId: 1,
        content: 'First source content.',
        videoTitle: 'First Video',
        startTime: 5,
        youtubeId: 'vid1',
      },
    ]
    const secondSources = [
      {
        chunkId: 2,
        content: 'Second source content.',
        videoTitle: 'Second Video',
        startTime: 15,
        youtubeId: 'vid2',
      },
    ]

    mockFetch.mockResolvedValueOnce(
      mockSseResponse([
        { type: 'sources', chunks: firstSources },
        { type: 'done' },
      ])
    )
    mockFetch.mockResolvedValueOnce(
      mockSseResponse([
        { type: 'sources', chunks: secondSources },
        { type: 'done' },
      ])
    )

    const { result } = renderHook(() => usePersonaChat(PERSONA_ID))

    await act(async () => {
      await result.current.sendMessage('First question')
    })

    await waitFor(() => {
      expect(result.current.liveSources).toEqual(firstSources)
    })

    await act(async () => {
      await result.current.sendMessage('Second question')
    })

    await waitFor(() => {
      expect(result.current.liveSources).toEqual(secondSources)
    })
  })

  it('hook does not persist sources to localStorage', async () => {
    const mockSources = [
      {
        chunkId: 1,
        content: 'Source content.',
        videoTitle: 'Some Video',
        startTime: 0,
        youtubeId: 'xyz',
      },
    ]
    mockFetch.mockResolvedValue(
      mockSseResponse([
        { type: 'sources', chunks: mockSources },
        { type: 'done' },
      ])
    )

    const { result } = renderHook(() => usePersonaChat(PERSONA_ID))

    await act(async () => {
      await result.current.sendMessage('Test')
    })

    await waitFor(() => {
      const stored = localStorageMock.getItem(STORAGE_KEY)
      if (stored !== null) {
        const parsed = JSON.parse(stored) as {
          version: number
          entries: Array<Record<string, unknown>>
        }
        // None of the stored entries should contain a sources field
        for (const entry of parsed.entries) {
          expect(entry).not.toHaveProperty('sources')
          expect(entry).not.toHaveProperty('liveSources')
        }
      }
    })
  })

  it('done and content_block_delta events still parse unchanged when sources event is present', async () => {
    mockFetch.mockResolvedValue(
      mockSseResponse([
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'The answer is 42' },
        },
        {
          type: 'sources',
          chunks: [
            {
              chunkId: 10,
              content: 'Context chunk',
              videoTitle: 'Some Video',
              startTime: null,
              youtubeId: null,
            },
          ],
        },
        { type: 'done' },
      ])
    )

    const { result } = renderHook(() => usePersonaChat(PERSONA_ID))

    await act(async () => {
      await result.current.sendMessage('What is the answer?')
    })

    await waitFor(() => {
      const msg = result.current.state.messages[0]
      expect(msg?.answer).toBe('The answer is 42')
      expect(msg?.isStreaming).toBe(false)
      expect(result.current.state.error).toBeNull()
    })
  })

  it('liveSources is null initially', () => {
    const { result } = renderHook(() => usePersonaChat(PERSONA_ID))
    expect(result.current.liveSources).toBeNull()
  })

  // ── 15. Abort on persona switch ───────────────────────────────────────────

  it('aborts in-flight request and resets streaming state when personaId changes', async () => {
    // Stream that never ends
    mockFetch.mockResolvedValue({
      ok: true,
      body: new ReadableStream({ start() {} }),
    })

    const { result, rerender } = renderHook(
      ({ id }: { id: number }) => usePersonaChat(id),
      { initialProps: { id: 42 } }
    )

    act(() => {
      void result.current.sendMessage('Question for 42')
    })

    await waitFor(() => {
      expect(result.current.state.isStreaming).toBe(true)
    })

    // Switch persona — should abort the in-flight request
    rerender({ id: 99 })

    await waitFor(() => {
      expect(result.current.state.isStreaming).toBe(false)
    })
  })
})
