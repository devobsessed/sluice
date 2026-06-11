import { describe, it, expect, vi, beforeEach } from 'vitest'
import { streamPersonaResponse } from '../streaming'
import type { Persona } from '@/lib/db/schema'
import type { SearchResult } from '@/lib/search/types'
import { streamMessages } from '@/lib/claude/client'

// Mock the claude client - streamMessages is the new path, streamText is NOT used for persona chat
vi.mock('@/lib/claude/client', () => ({
  streamMessages: vi.fn(),
}))

const mockStreamMessages = vi.mocked(streamMessages)

/** Helper to create a mock stream that mimics MessageStream */
function createMockStream(options: {
  contentBlockDeltas?: Array<{ type: string, index: number, delta: { type: string, text: string } }>
  finalContent?: string
  error?: Error
}) {
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>()

  const stream = {
    on(event: string, cb: (...args: unknown[]) => void) {
      if (!listeners.has(event)) listeners.set(event, [])
      listeners.get(event)!.push(cb)
      return stream
    },
    finalMessage: vi.fn(async () => {
      if (options.error) throw options.error

      // Emit streamEvent events (raw API events, same as MessageStream)
      if (options.contentBlockDeltas) {
        for (const delta of options.contentBlockDeltas) {
          for (const cb of listeners.get('streamEvent') ?? []) {
            cb(delta)
          }
        }
      }

      return {
        content: [{ type: 'text' as const, text: options.finalContent ?? '' }],
      }
    }),
  }

  return stream
}

describe('streamPersonaResponse', () => {
  const mockPersona: Persona = {
    id: 1,
    channelName: 'Test Channel',
    name: 'Test Creator',
    systemPrompt: 'You are Test Creator. You teach programming.',
    expertiseTopics: ['programming', 'typescript'],
    expertiseEmbedding: null,
    transcriptCount: 30,
    createdAt: new Date(),
  }

  const strongContext: SearchResult[] = [
    {
      chunkId: 1,
      content: 'TypeScript is a typed superset of JavaScript.',
      startTime: 10,
      endTime: 20,
      videoId: 1,
      videoTitle: 'Intro to TypeScript',
      channel: 'Test Channel',
      youtubeId: 'abc123',
      thumbnail: null,
      similarity: 0.92,
    },
    {
      chunkId: 2,
      content: 'TypeScript adds static types to JavaScript.',
      startTime: 30,
      endTime: 40,
      videoId: 1,
      videoTitle: 'Intro to TypeScript',
      channel: 'Test Channel',
      youtubeId: 'abc123',
      thumbnail: null,
      similarity: 0.88,
    },
    {
      chunkId: 3,
      content: 'Interfaces define object shapes in TypeScript.',
      startTime: 50,
      endTime: 60,
      videoId: 2,
      videoTitle: 'TypeScript Deep Dive',
      channel: 'Test Channel',
      youtubeId: 'def456',
      thumbnail: null,
      similarity: 0.85,
    },
  ]

  const weakContext: SearchResult[] = [
    {
      chunkId: 1,
      content: 'Vaguely related content.',
      startTime: 10,
      endTime: 20,
      videoId: 1,
      videoTitle: 'Some Video',
      channel: 'Test Channel',
      youtubeId: 'abc123',
      thumbnail: null,
      similarity: 0.28, // below the weak threshold
    },
  ]

  beforeEach(() => {
    mockStreamMessages.mockReset()
  })

  it('should return a ReadableStream', async () => {
    const mockStream = createMockStream({
      contentBlockDeltas: [{
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Hello' },
      }],
      finalContent: 'Hello',
    })

    mockStreamMessages.mockReturnValue(mockStream as never)

    const stream = await streamPersonaResponse({
      persona: mockPersona,
      question: 'What is TypeScript?',
      context: strongContext,
    })

    expect(stream).toBeInstanceOf(ReadableStream)
  })

  it('calls streamMessages (not streamText) with system and messages', async () => {
    const mockStream = createMockStream({ finalContent: 'Response' })
    mockStreamMessages.mockReturnValue(mockStream as never)

    await streamPersonaResponse({
      persona: mockPersona,
      question: 'What is TypeScript?',
      context: strongContext,
    })

    expect(mockStreamMessages).toHaveBeenCalledOnce()
    const callArg = mockStreamMessages.mock.calls[0]?.[0]
    expect(callArg).toHaveProperty('system')
    expect(callArg).toHaveProperty('messages')
  })

  it('system param contains the persona document', async () => {
    const mockStream = createMockStream({ finalContent: 'Response' })
    mockStreamMessages.mockReturnValue(mockStream as never)

    await streamPersonaResponse({
      persona: mockPersona,
      question: 'What is TypeScript?',
      context: strongContext,
    })

    const { system } = mockStreamMessages.mock.calls[0]![0]
    expect(system).toContain(mockPersona.systemPrompt)
  })

  it('latest user message carries the <context> block; prior turns do not', async () => {
    const mockStream = createMockStream({ finalContent: 'Response' })
    mockStreamMessages.mockReturnValue(mockStream as never)

    await streamPersonaResponse({
      persona: mockPersona,
      question: 'What about hooks?',
      context: strongContext,
      history: [
        { question: 'What is TypeScript?', answer: 'TypeScript is a typed superset.' },
        { question: 'What are interfaces?', answer: 'Interfaces define shapes.' },
      ],
    })

    const { messages } = mockStreamMessages.mock.calls[0]![0]
    // Last user message should have context
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')
    expect(lastUserMsg?.content).toContain('<context>')
    expect(lastUserMsg?.content).toContain('</context>')
    expect(lastUserMsg?.content).toContain('What about hooks?')

    // Prior user messages should NOT have context blocks
    const priorUserMsgs = messages
      .filter(m => m.role === 'user')
      .slice(0, -1)
    for (const msg of priorUserMsgs) {
      expect(msg.content).not.toContain('<context>')
    }
  })

  it('history maps 1:1 to alternating user/assistant message pairs in order', async () => {
    const mockStream = createMockStream({ finalContent: 'Response' })
    mockStreamMessages.mockReturnValue(mockStream as never)

    const history = [
      { question: 'What is TypeScript?', answer: 'A typed superset of JavaScript.' },
      { question: 'What are interfaces?', answer: 'Interfaces define the shape of objects.' },
    ]

    await streamPersonaResponse({
      persona: mockPersona,
      question: 'What about generics?',
      context: strongContext,
      history,
    })

    const { messages } = mockStreamMessages.mock.calls[0]![0]

    // messages = [user(h1), assistant(h1), user(h2), assistant(h2), user(current)]
    expect(messages[0]?.role).toBe('user')
    expect(messages[0]?.content).toBe(history[0]!.question)
    expect(messages[1]?.role).toBe('assistant')
    expect(messages[1]?.content).toBe(history[0]!.answer)
    expect(messages[2]?.role).toBe('user')
    expect(messages[2]?.content).toBe(history[1]!.question)
    expect(messages[3]?.role).toBe('assistant')
    expect(messages[3]?.content).toBe(history[1]!.answer)
    // last message is the current question with context
    expect(messages[4]?.role).toBe('user')
    expect(messages[4]?.content).toContain('What about generics?')
  })

  it('handles no history - only the current question turn', async () => {
    const mockStream = createMockStream({ finalContent: 'Response' })
    mockStreamMessages.mockReturnValue(mockStream as never)

    await streamPersonaResponse({
      persona: mockPersona,
      question: 'What is TypeScript?',
      context: strongContext,
    })

    const { messages } = mockStreamMessages.mock.calls[0]![0]
    // Only one message: the current user question
    expect(messages).toHaveLength(1)
    expect(messages[0]?.role).toBe('user')
  })

  // ── Zero-retrieval guard ────────────────────────────────────────────────────

  it('system contains zero-retrieval instruction when context is empty', async () => {
    const mockStream = createMockStream({ finalContent: 'Response' })
    mockStreamMessages.mockReturnValue(mockStream as never)

    await streamPersonaResponse({
      persona: mockPersona,
      question: 'What is React?',
      context: [],
    })

    const { system } = mockStreamMessages.mock.calls[0]![0]
    // Must say something about no coverage / no content retrieved
    expect(system.toLowerCase()).toMatch(/no (content|coverage|information|transcript)/)
    // Must NOT permit or encourage answering from general knowledge
    // "Do NOT answer from general knowledge" is fine; "you can answer from general knowledge" is not
    expect(system).not.toMatch(/you (can|may|should|could) (answer|use|rely on) (from )?general knowledge/i)
  })

  it('system omits zero-retrieval instruction when context is non-empty', async () => {
    const mockStream = createMockStream({ finalContent: 'Response' })
    mockStreamMessages.mockReturnValue(mockStream as never)

    await streamPersonaResponse({
      persona: mockPersona,
      question: 'What is TypeScript?',
      context: strongContext,
    })

    const { system } = mockStreamMessages.mock.calls[0]![0]
    // The zero-retrieval guard text should not appear when we have good context
    expect(system).not.toMatch(/no content retrieved/i)
    expect(system).not.toMatch(/no coverage/i)
  })

  // ── Weak-retrieval / ask-back guard ────────────────────────────────────────

  it('system contains soft weak-retrieval/ask-back text for low count/low similarity', async () => {
    const mockStream = createMockStream({ finalContent: 'Response' })
    mockStreamMessages.mockReturnValue(mockStream as never)

    await streamPersonaResponse({
      persona: mockPersona,
      question: 'Tell me about something obscure',
      context: weakContext, // 1 chunk, similarity 0.28 - both below threshold
    })

    const { system } = mockStreamMessages.mock.calls[0]![0]
    // Should contain a soft signal about weak retrieval
    expect(system.toLowerCase()).toMatch(/(weak|limited|low|not enough|insufficient|sparse)/)
    // Should permit one clarifying question (ask-back)
    expect(system.toLowerCase()).toMatch(/(clarif|question|ask)/)
  })

  it('system omits weak-retrieval text for strong retrieval (high count + high similarity)', async () => {
    const mockStream = createMockStream({ finalContent: 'Response' })
    mockStreamMessages.mockReturnValue(mockStream as never)

    await streamPersonaResponse({
      persona: mockPersona,
      question: 'What is TypeScript?',
      context: strongContext, // 3 chunks, high similarity
    })

    const { system } = mockStreamMessages.mock.calls[0]![0]
    // No weak-retrieval nudge for strong results
    expect(system).not.toMatch(/weak retrieval/i)
    expect(system).not.toMatch(/low score/i)
  })

  it('no numeric threshold value appears in the emitted system text', async () => {
    const mockStream = createMockStream({ finalContent: 'Response' })
    mockStreamMessages.mockReturnValue(mockStream as never)

    await streamPersonaResponse({
      persona: mockPersona,
      question: 'What is TypeScript?',
      context: weakContext,
    })

    const { system } = mockStreamMessages.mock.calls[0]![0]
    // Guard thresholds must be computed in code, not exposed as numbers to the model
    // Check that no decimal values that look like similarity scores appear
    expect(system).not.toMatch(/\b0\.\d{2,}\b/)
    expect(system).not.toMatch(/\bsimilarity\s*[=:]\s*\d/)
    expect(system).not.toMatch(/\bscore\s*(above|below|greater|less)\s+\d/)
    expect(system).not.toMatch(/\bcount\s*[=<>]\s*\d/)
  })

  // ── Citation instruction ────────────────────────────────────────────────────

  it('system contains citation instruction for numbered context blocks', async () => {
    const mockStream = createMockStream({ finalContent: 'Response' })
    mockStreamMessages.mockReturnValue(mockStream as never)

    await streamPersonaResponse({
      persona: mockPersona,
      question: 'What is TypeScript?',
      context: strongContext,
    })

    const { system } = mockStreamMessages.mock.calls[0]![0]
    // Should instruct model to cite passage numbers [n]
    expect(system).toMatch(/\[n\]|\[1\]|passage number|cite/i)
  })

  // ── Abort signal ────────────────────────────────────────────────────────────

  it('passes abort signal through to streamMessages', async () => {
    const abortController = new AbortController()
    const mockStream = createMockStream({ finalContent: 'Response' })
    mockStreamMessages.mockReturnValue(mockStream as never)

    await streamPersonaResponse({
      persona: mockPersona,
      question: 'What is TypeScript?',
      context: strongContext,
      signal: abortController.signal,
    })

    const callArg = mockStreamMessages.mock.calls[0]?.[0]
    expect(callArg?.signal).toBe(abortController.signal)
  })

  it('handles abort signal when already aborted', async () => {
    const abortController = new AbortController()
    abortController.abort()

    const mockStream = createMockStream({ error: new Error('Aborted') })
    mockStreamMessages.mockReturnValue(mockStream as never)

    const stream = await streamPersonaResponse({
      persona: mockPersona,
      question: 'What is TypeScript?',
      context: strongContext,
      signal: abortController.signal,
    })

    const reader = stream.getReader()
    await expect(reader.read()).rejects.toThrow()
  })

  // ── SSE relay (ensemble contract) ──────────────────────────────────────────

  it('emitted SSE still produces content_block_delta then done (ensemble contract intact)', async () => {
    const mockStream = createMockStream({
      contentBlockDeltas: [{
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Hello' },
      }],
      finalContent: 'Hello',
    })

    mockStreamMessages.mockReturnValue(mockStream as never)

    const stream = await streamPersonaResponse({
      persona: mockPersona,
      question: 'What is TypeScript?',
      context: strongContext,
    })

    const reader = stream.getReader()
    const decoder = new TextDecoder()

    // Collect all SSE events
    const events: Record<string, unknown>[] = []
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = decoder.decode(value)
      for (const line of chunk.split('\n')) {
        if (line.startsWith('data:')) {
          const data = JSON.parse(line.slice(5).trim()) as Record<string, unknown>
          events.push(data)
        }
      }
    }

    // Must contain content_block_delta and done; sources is additive (does not remove either)
    const types = events.map(e => e['type'])
    expect(types).toContain('content_block_delta')
    expect(types).toContain('done')
    // done must be the last event
    expect(types[types.length - 1]).toBe('done')
    // content_block_delta must appear before done
    const deltaIdx = types.indexOf('content_block_delta')
    const doneIdx = types.indexOf('done')
    expect(deltaIdx).toBeLessThan(doneIdx)
  })

  // ── Sources event ──────────────────────────────────────────────────────────

  it('query stream emits a sources event with chunkId/content/videoTitle/startTime/youtubeId', async () => {
    const mockStream = createMockStream({ finalContent: 'Response' })
    mockStreamMessages.mockReturnValue(mockStream as never)

    const stream = await streamPersonaResponse({
      persona: mockPersona,
      question: 'What is TypeScript?',
      context: strongContext,
    })

    const reader = stream.getReader()
    const decoder = new TextDecoder()
    const events: Record<string, unknown>[] = []

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = decoder.decode(value)
      for (const line of chunk.split('\n')) {
        if (line.startsWith('data:')) {
          const data = JSON.parse(line.slice(5).trim()) as Record<string, unknown>
          events.push(data)
        }
      }
    }

    const sourcesEvent = events.find(e => e['type'] === 'sources')
    expect(sourcesEvent).toBeDefined()
    expect(sourcesEvent).toHaveProperty('chunks')
    const chunks = sourcesEvent!['chunks'] as Array<Record<string, unknown>>
    expect(Array.isArray(chunks)).toBe(true)
    expect(chunks.length).toBeGreaterThan(0)

    // Each chunk must carry the required fields
    for (const c of chunks) {
      expect(c).toHaveProperty('chunkId')
      expect(c).toHaveProperty('content')
      expect(c).toHaveProperty('videoTitle')
      expect('startTime' in c).toBe(true) // may be null
      expect('youtubeId' in c).toBe(true) // may be null
    }
  })

  it('sources order matches the numbered context order ([n] resolves to chunks[n-1])', async () => {
    const mockStream = createMockStream({ finalContent: 'Response' })
    mockStreamMessages.mockReturnValue(mockStream as never)

    const stream = await streamPersonaResponse({
      persona: mockPersona,
      question: 'What is TypeScript?',
      context: strongContext,
    })

    const reader = stream.getReader()
    const decoder = new TextDecoder()
    const events: Record<string, unknown>[] = []

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = decoder.decode(value)
      for (const line of chunk.split('\n')) {
        if (line.startsWith('data:')) {
          events.push(JSON.parse(line.slice(5).trim()) as Record<string, unknown>)
        }
      }
    }

    const sourcesEvent = events.find(e => e['type'] === 'sources')
    const chunks = sourcesEvent!['chunks'] as Array<Record<string, unknown>>

    // chunks[0] should be chunkId 1 (first in strongContext), chunks[1] chunkId 2, etc.
    expect(chunks[0]!['chunkId']).toBe(strongContext[0]!.chunkId)
    expect(chunks[1]!['chunkId']).toBe(strongContext[1]!.chunkId)
    expect(chunks[2]!['chunkId']).toBe(strongContext[2]!.chunkId)
  })

  it('sources event is emitted before done', async () => {
    const mockStream = createMockStream({ finalContent: 'Response' })
    mockStreamMessages.mockReturnValue(mockStream as never)

    const stream = await streamPersonaResponse({
      persona: mockPersona,
      question: 'What is TypeScript?',
      context: strongContext,
    })

    const reader = stream.getReader()
    const decoder = new TextDecoder()
    const events: Record<string, unknown>[] = []

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = decoder.decode(value)
      for (const line of chunk.split('\n')) {
        if (line.startsWith('data:')) {
          events.push(JSON.parse(line.slice(5).trim()) as Record<string, unknown>)
        }
      }
    }

    const types = events.map(e => e['type'])
    const sourcesIdx = types.indexOf('sources')
    const doneIdx = types.indexOf('done')
    expect(sourcesIdx).toBeGreaterThanOrEqual(0)
    expect(sourcesIdx).toBeLessThan(doneIdx)
  })

  it('sources event emits empty chunks array when context is empty', async () => {
    const mockStream = createMockStream({ finalContent: 'Response' })
    mockStreamMessages.mockReturnValue(mockStream as never)

    const stream = await streamPersonaResponse({
      persona: mockPersona,
      question: 'What is React?',
      context: [],
    })

    const reader = stream.getReader()
    const decoder = new TextDecoder()
    const events: Record<string, unknown>[] = []

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = decoder.decode(value)
      for (const line of chunk.split('\n')) {
        if (line.startsWith('data:')) {
          events.push(JSON.parse(line.slice(5).trim()) as Record<string, unknown>)
        }
      }
    }

    const sourcesEvent = events.find(e => e['type'] === 'sources')
    expect(sourcesEvent).toBeDefined()
    const chunks = sourcesEvent!['chunks'] as Array<Record<string, unknown>>
    expect(chunks).toHaveLength(0)
  })

  it('handles stream errors gracefully', async () => {
    const mockStream = createMockStream({ error: new Error('Stream failed') })
    mockStreamMessages.mockReturnValue(mockStream as never)

    const stream = await streamPersonaResponse({
      persona: mockPersona,
      question: 'What is TypeScript?',
      context: strongContext,
    })

    const reader = stream.getReader()
    await expect(reader.read()).rejects.toThrow('Stream failed')
  })

  it('limits context to avoid exceeding token budget', async () => {
    const largeContext: SearchResult[] = Array.from({ length: 20 }, (_, i) => ({
      chunkId: i,
      content: 'A'.repeat(500),
      startTime: i * 10,
      endTime: (i + 1) * 10,
      videoId: 1,
      videoTitle: 'Video',
      channel: 'Channel',
      youtubeId: 'abc',
      thumbnail: null,
      similarity: 0.9,
    }))

    const mockStream = createMockStream({ finalContent: 'Response' })
    mockStreamMessages.mockReturnValue(mockStream as never)

    await streamPersonaResponse({
      persona: mockPersona,
      question: 'Question?',
      context: largeContext,
    })

    const { messages } = mockStreamMessages.mock.calls[0]![0]
    const lastUserMsg = messages[messages.length - 1]!
    // Context-limited - should not be excessively large
    expect(lastUserMsg.content.length).toBeLessThan(20000)
  })

  // ── Guard observability ────────────────────────────────────────────────────

  it('logs the zero-retrieval guard branch when context is empty', async () => {
    const mockStream = createMockStream({ finalContent: 'Response' })
    mockStreamMessages.mockReturnValue(mockStream as never)

    const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})

    await streamPersonaResponse({
      persona: mockPersona,
      question: 'What is React?',
      context: [],
    })

    const calls = consoleSpy.mock.calls.map(args => args.join(' '))
    const guardLog = calls.find(c => c.includes('[persona-guard]'))
    expect(guardLog).toBeDefined()
    expect(guardLog).toMatch(/zero.retrieval/i)

    consoleSpy.mockRestore()
  })

  it('logs the weak-retrieval guard branch when retrieval is weak', async () => {
    const mockStream = createMockStream({ finalContent: 'Response' })
    mockStreamMessages.mockReturnValue(mockStream as never)

    const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})

    await streamPersonaResponse({
      persona: mockPersona,
      question: 'Obscure question',
      context: weakContext,
    })

    const calls = consoleSpy.mock.calls.map(args => args.join(' '))
    const guardLog = calls.find(c => c.includes('[persona-guard]'))
    expect(guardLog).toBeDefined()
    expect(guardLog).toMatch(/weak.retrieval/i)
    // Log should include count and top similarity
    expect(guardLog).toMatch(/count=/)
    expect(guardLog).toMatch(/topSim=/)

    consoleSpy.mockRestore()
  })

  it('logs nothing for strong retrieval', async () => {
    const mockStream = createMockStream({ finalContent: 'Response' })
    mockStreamMessages.mockReturnValue(mockStream as never)

    const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})

    await streamPersonaResponse({
      persona: mockPersona,
      question: 'What is TypeScript?',
      context: strongContext,
    })

    const calls = consoleSpy.mock.calls.map(args => args.join(' '))
    const guardLog = calls.find(c => c.includes('[persona-guard]'))
    expect(guardLog).toBeUndefined()

    consoleSpy.mockRestore()
  })
})
