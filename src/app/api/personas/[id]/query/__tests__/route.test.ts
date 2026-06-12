import { describe, it, expect, beforeEach, vi } from 'vitest'
import { POST } from '../route'
import { db } from '@/lib/db'
import { getPersonaContext } from '@/lib/personas/context'
import { streamPersonaResponse } from '@/lib/personas/streaming'
import type { Persona } from '@/lib/db/schema'

vi.mock('@/lib/auth-guards', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth-guards')>()
  return {
    ...actual,
    requireSession: vi.fn().mockResolvedValue(null),
  }
})

// Mock dependencies
vi.mock('@/lib/db', async () => {
  const actual = await vi.importActual('@/lib/db')
  return {
    ...actual,
    db: {
      select: vi.fn(),
    },
  }
})

vi.mock('@/lib/personas/context', () => ({
  getPersonaContext: vi.fn(),
}))

vi.mock('@/lib/personas/streaming', () => ({
  streamPersonaResponse: vi.fn(),
}))

vi.mock('@/lib/personas/query-rewrite', () => ({
  rewriteFollowUpQuery: vi.fn(),
}))

vi.mock('@/lib/personas/ensemble', () => ({
  findBestPersonas: vi.fn(),
}))

import { rewriteFollowUpQuery } from '@/lib/personas/query-rewrite'
import { findBestPersonas } from '@/lib/personas/ensemble'

const mockDb = vi.mocked(db)
const mockGetPersonaContext = vi.mocked(getPersonaContext)
const mockStreamPersonaResponse = vi.mocked(streamPersonaResponse)
const mockRewriteFollowUpQuery = vi.mocked(rewriteFollowUpQuery)
const mockFindBestPersonas = vi.mocked(findBestPersonas)

describe('POST /api/personas/[id]/query', () => {
  const mockPersona: Persona = {
    id: 1,
    channelName: 'Test Channel',
    name: 'Test Creator',
    systemPrompt: 'You are Test Creator.',
    expertiseTopics: ['programming', 'typescript'],
    expertiseEmbedding: null,
    transcriptCount: 30,
    createdAt: new Date(),
  }

  const mockOtherPersona: Persona = {
    id: 2,
    channelName: 'Other Channel',
    name: 'Other Creator',
    systemPrompt: 'You are Other Creator.',
    expertiseTopics: ['databases'],
    expertiseEmbedding: [0.1, 0.2] as unknown as Persona['expertiseEmbedding'],
    transcriptCount: 40,
    createdAt: new Date(),
  }

  beforeEach(() => {
    vi.clearAllMocks()

    // Default mock: successful persona lookup (returns current persona only on first call;
    // second call for all-personas fetch returns both personas)
    let selectCallCount = 0
    mockDb.select = vi.fn().mockImplementation(() => {
      selectCallCount++
      return {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockImplementation(() => {
          // First select is the single-persona fetch
          if (selectCallCount === 1) return Promise.resolve([mockPersona])
          return Promise.resolve([mockPersona, mockOtherPersona])
        }),
        // No .where/.limit for all-personas fetch
        then: undefined as unknown,
      }
    })

    // Simpler approach: track calls to .from() to distinguish the two selects
    mockDb.select = vi.fn().mockReturnValue({
      from: vi.fn().mockImplementation((table) => {
        void table
        return {
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([mockPersona]),
          }),
          // For all-personas fetch (no where/limit chain used)
          limit: vi.fn().mockResolvedValue([mockPersona, mockOtherPersona]),
        }
      }),
    })

    // Default mock: return empty context
    mockGetPersonaContext.mockResolvedValue([])

    // Default mock: rewrite passes question through unchanged (no-trigger / first question)
    mockRewriteFollowUpQuery.mockImplementation(
      async ({ question }: { question: string }) => question,
    )

    // Default mock: findBestPersonas returns [] (no embeddings - no handoff)
    mockFindBestPersonas.mockResolvedValue([])

    // Default mock: return streaming response
    mockStreamPersonaResponse.mockResolvedValue(
      new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder()
          controller.enqueue(encoder.encode('data: {"type":"delta","text":"Hello"}\n\n'))
          controller.enqueue(encoder.encode('data: {"type":"done"}\n\n'))
          controller.close()
        },
      })
    )
  })

  it('should return 400 if request body is invalid', async () => {
    const request = new Request('http://localhost/api/personas/1/query', {
      method: 'POST',
      body: JSON.stringify({}), // Missing question
    })

    const response = await POST(request, { params: Promise.resolve({ id: '1' }) })

    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toBeTruthy()
  })

  it('should return 400 if id is not a valid number', async () => {
    const request = new Request('http://localhost/api/personas/abc/query', {
      method: 'POST',
      body: JSON.stringify({ question: 'What is TypeScript?' }),
    })

    const response = await POST(request, { params: Promise.resolve({ id: 'abc' }) })

    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('Invalid persona ID')
  })

  it('should return 404 if persona not found', async () => {
    // Mock empty result
    mockDb.select = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    })

    const request = new Request('http://localhost/api/personas/999/query', {
      method: 'POST',
      body: JSON.stringify({ question: 'What is TypeScript?' }),
    })

    const response = await POST(request, { params: Promise.resolve({ id: '999' }) })

    expect(response.status).toBe(404)
    const data = await response.json()
    expect(data.error).toContain('Persona not found')
  })

  it('should return streaming response for valid request', async () => {
    const request = new Request('http://localhost/api/personas/1/query', {
      method: 'POST',
      body: JSON.stringify({ question: 'What is TypeScript?' }),
    })

    const response = await POST(request, { params: Promise.resolve({ id: '1' }) })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/event-stream')
    expect(response.headers.get('cache-control')).toBe('no-cache')
    expect(response.headers.get('connection')).toBe('keep-alive')
  })

  it('should fetch context for persona channel', async () => {
    const request = new Request('http://localhost/api/personas/1/query', {
      method: 'POST',
      body: JSON.stringify({ question: 'What is TypeScript?' }),
    })

    await POST(request, { params: Promise.resolve({ id: '1' }) })

    // rewriteFollowUpQuery returns the original question (default mock) so
    // getPersonaContext still receives the raw question on the no-trigger path
    expect(mockGetPersonaContext).toHaveBeenCalledWith('Test Channel', 'What is TypeScript?')
  })

  it('should handle empty question', async () => {
    const request = new Request('http://localhost/api/personas/1/query', {
      method: 'POST',
      body: JSON.stringify({ question: '' }),
    })

    const response = await POST(request, { params: Promise.resolve({ id: '1' }) })

    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toBeTruthy()
  })

  it('should handle questions with special characters', async () => {
    const request = new Request('http://localhost/api/personas/1/query', {
      method: 'POST',
      body: JSON.stringify({ question: "What's the difference between 'let' and 'const'?" }),
    })

    const response = await POST(request, { params: Promise.resolve({ id: '1' }) })

    expect(response.status).toBe(200)
  })

  it('should return 500 if streaming fails', async () => {
    mockStreamPersonaResponse.mockRejectedValueOnce(new Error('API error'))

    const request = new Request('http://localhost/api/personas/1/query', {
      method: 'POST',
      body: JSON.stringify({ question: 'What is TypeScript?' }),
    })

    const response = await POST(request, { params: Promise.resolve({ id: '1' }) })

    expect(response.status).toBe(500)
    const data = await response.json()
    expect(data.error).toBeTruthy()
  })

  it('should validate question is a string', async () => {
    const request = new Request('http://localhost/api/personas/1/query', {
      method: 'POST',
      body: JSON.stringify({ question: 123 }),
    })

    const response = await POST(request, { params: Promise.resolve({ id: '1' }) })

    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toBeTruthy()
  })

  it('should handle malformed JSON', async () => {
    const request = new Request('http://localhost/api/personas/1/query', {
      method: 'POST',
      body: 'invalid json',
    })

    const response = await POST(request, { params: Promise.resolve({ id: '1' }) })

    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toBeTruthy()
  })

  // ── Chunk 3: rewrite slot wiring ──────────────────────────────────────────────

  it('route passes the rewritten search query to getPersonaContext', async () => {
    const rewrittenQuery = 'React hook performance optimization techniques'
    mockRewriteFollowUpQuery.mockResolvedValue(rewrittenQuery)

    const request = new Request('http://localhost/api/personas/1/query', {
      method: 'POST',
      body: JSON.stringify({
        question: 'expand on that',
        history: [{ question: 'What is React?', answer: 'A JS library.' }],
      }),
    })

    await POST(request, { params: Promise.resolve({ id: '1' }) })

    // getPersonaContext must receive the REWRITTEN query, not the original
    expect(mockGetPersonaContext).toHaveBeenCalledWith('Test Channel', rewrittenQuery)
  })

  it('route passes the ORIGINAL question (not the rewritten query) to streamPersonaResponse', async () => {
    const originalQuestion = 'expand on that'
    const rewrittenQuery = 'React hook performance optimization techniques'
    mockRewriteFollowUpQuery.mockResolvedValue(rewrittenQuery)

    const request = new Request('http://localhost/api/personas/1/query', {
      method: 'POST',
      body: JSON.stringify({
        question: originalQuestion,
        history: [{ question: 'What is React?', answer: 'A JS library.' }],
      }),
    })

    await POST(request, { params: Promise.resolve({ id: '1' }) })

    // streamPersonaResponse must receive the ORIGINAL question - not the rewritten string
    expect(mockStreamPersonaResponse).toHaveBeenCalledWith(
      expect.objectContaining({ question: originalQuestion }),
    )
    // And the rewritten string must NOT appear as the question
    expect(mockStreamPersonaResponse).not.toHaveBeenCalledWith(
      expect.objectContaining({ question: rewrittenQuery }),
    )
  })

  it('route still works when rewriteFollowUpQuery returns the original question (no-trigger / fallback path)', async () => {
    const originalQuestion = 'What are the performance implications of React context vs Zustand?'
    // rewriteFollowUpQuery returns the original (heuristic did not fire or fallback)
    mockRewriteFollowUpQuery.mockResolvedValue(originalQuestion)

    const request = new Request('http://localhost/api/personas/1/query', {
      method: 'POST',
      body: JSON.stringify({ question: originalQuestion }),
    })

    const response = await POST(request, { params: Promise.resolve({ id: '1' }) })

    expect(response.status).toBe(200)
    expect(mockGetPersonaContext).toHaveBeenCalledWith('Test Channel', originalQuestion)
    expect(mockStreamPersonaResponse).toHaveBeenCalledWith(
      expect.objectContaining({ question: originalQuestion }),
    )
  })

  // ── Chunk 3: facts validation + handoff routing ───────────────────────────────

  it('accepts facts array up to 5 elements', async () => {
    const request = new Request('http://localhost/api/personas/1/query', {
      method: 'POST',
      body: JSON.stringify({
        question: 'What is TypeScript?',
        facts: ['exploring TypeScript patterns', 'uses Drizzle ORM', 'prefers Postgres', 'follows TDD', 'builds with Next.js'],
      }),
    })

    const response = await POST(request, { params: Promise.resolve({ id: '1' }) })

    expect(response.status).toBe(200)
  })

  it('rejects facts array with more than 5 elements', async () => {
    const request = new Request('http://localhost/api/personas/1/query', {
      method: 'POST',
      body: JSON.stringify({
        question: 'What is TypeScript?',
        facts: ['fact1', 'fact2', 'fact3', 'fact4', 'fact5', 'fact6'],
      }),
    })

    const response = await POST(request, { params: Promise.resolve({ id: '1' }) })

    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toBeTruthy()
  })

  it('accepts request without facts (facts is optional)', async () => {
    const request = new Request('http://localhost/api/personas/1/query', {
      method: 'POST',
      body: JSON.stringify({ question: 'What is TypeScript?' }),
    })

    const response = await POST(request, { params: Promise.resolve({ id: '1' }) })

    expect(response.status).toBe(200)
  })

  it('passes facts to streamPersonaResponse', async () => {
    const facts = ['exploring TypeScript patterns', 'uses Drizzle ORM']

    const request = new Request('http://localhost/api/personas/1/query', {
      method: 'POST',
      body: JSON.stringify({ question: 'What is TypeScript?', facts }),
    })

    await POST(request, { params: Promise.resolve({ id: '1' }) })

    expect(mockStreamPersonaResponse).toHaveBeenCalledWith(
      expect.objectContaining({ facts }),
    )
  })

  it('emits handoff event when another persona exceeds margin', async () => {
    // Current persona (id=1) scores 0.60; other persona (id=2) scores 0.82 - margin 0.22 >= 0.15
    mockFindBestPersonas.mockResolvedValue([
      { persona: mockOtherPersona, score: 0.82 },
      { persona: mockPersona, score: 0.60 },
    ])

    // Make streamPersonaResponse emit a real stream that we can read
    mockStreamPersonaResponse.mockResolvedValue(
      new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder()
          controller.enqueue(encoder.encode('data: {"type":"done"}\n\n'))
          controller.close()
        },
      })
    )

    const request = new Request('http://localhost/api/personas/1/query', {
      method: 'POST',
      body: JSON.stringify({ question: 'Tell me about databases' }),
    })

    const response = await POST(request, { params: Promise.resolve({ id: '1' }) })
    expect(response.status).toBe(200)

    const reader = response.body!.getReader()
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

    const handoffEvent = events.find(e => e['type'] === 'handoff')
    expect(handoffEvent).toBeDefined()
    expect(handoffEvent!['personaId']).toBe(2)
    expect(handoffEvent!['personaName']).toBe('Other Creator')
  })

  it('handoff event appears before the answer stream', async () => {
    mockFindBestPersonas.mockResolvedValue([
      { persona: mockOtherPersona, score: 0.82 },
      { persona: mockPersona, score: 0.60 },
    ])

    mockStreamPersonaResponse.mockResolvedValue(
      new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder()
          controller.enqueue(encoder.encode('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}\n\n'))
          controller.enqueue(encoder.encode('data: {"type":"done"}\n\n'))
          controller.close()
        },
      })
    )

    const request = new Request('http://localhost/api/personas/1/query', {
      method: 'POST',
      body: JSON.stringify({ question: 'Tell me about databases' }),
    })

    const response = await POST(request, { params: Promise.resolve({ id: '1' }) })
    const reader = response.body!.getReader()
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
    const handoffIdx = types.indexOf('handoff')
    const deltaIdx = types.indexOf('content_block_delta')
    expect(handoffIdx).toBeGreaterThanOrEqual(0)
    expect(deltaIdx).toBeGreaterThan(handoffIdx)
  })

  it('does NOT emit handoff when current persona is already the best match', async () => {
    // Current persona (id=1) scores highest
    mockFindBestPersonas.mockResolvedValue([
      { persona: mockPersona, score: 0.90 },
      { persona: mockOtherPersona, score: 0.70 },
    ])

    mockStreamPersonaResponse.mockResolvedValue(
      new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder()
          controller.enqueue(encoder.encode('data: {"type":"done"}\n\n'))
          controller.close()
        },
      })
    )

    const request = new Request('http://localhost/api/personas/1/query', {
      method: 'POST',
      body: JSON.stringify({ question: 'What is TypeScript?' }),
    })

    const response = await POST(request, { params: Promise.resolve({ id: '1' }) })
    const reader = response.body!.getReader()
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

    const handoffEvent = events.find(e => e['type'] === 'handoff')
    expect(handoffEvent).toBeUndefined()
  })

  it('does NOT emit handoff when margin is below threshold', async () => {
    // Other persona scores higher but only by 0.10, below HANDOFF_MARGIN=0.15
    mockFindBestPersonas.mockResolvedValue([
      { persona: mockOtherPersona, score: 0.80 },
      { persona: mockPersona, score: 0.72 },
    ])

    mockStreamPersonaResponse.mockResolvedValue(
      new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder()
          controller.enqueue(encoder.encode('data: {"type":"done"}\n\n'))
          controller.close()
        },
      })
    )

    const request = new Request('http://localhost/api/personas/1/query', {
      method: 'POST',
      body: JSON.stringify({ question: 'What is React?' }),
    })

    const response = await POST(request, { params: Promise.resolve({ id: '1' }) })
    const reader = response.body!.getReader()
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

    const handoffEvent = events.find(e => e['type'] === 'handoff')
    expect(handoffEvent).toBeUndefined()
  })

  it('skips handoff safely when no personas have embeddings (findBestPersonas returns [])', async () => {
    mockFindBestPersonas.mockResolvedValue([])

    mockStreamPersonaResponse.mockResolvedValue(
      new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder()
          controller.enqueue(encoder.encode('data: {"type":"done"}\n\n'))
          controller.close()
        },
      })
    )

    const request = new Request('http://localhost/api/personas/1/query', {
      method: 'POST',
      body: JSON.stringify({ question: 'What is TypeScript?' }),
    })

    const response = await POST(request, { params: Promise.resolve({ id: '1' }) })
    expect(response.status).toBe(200)

    const reader = response.body!.getReader()
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

    const handoffEvent = events.find(e => e['type'] === 'handoff')
    expect(handoffEvent).toBeUndefined()
    // Answer still streams
    const doneEvent = events.find(e => e['type'] === 'done')
    expect(doneEvent).toBeDefined()
  })

  it('route emits handoff SSE event with correct personaId and personaName', async () => {
    mockFindBestPersonas.mockResolvedValue([
      { persona: mockOtherPersona, score: 0.85 },
      { persona: mockPersona, score: 0.60 },
    ])

    mockStreamPersonaResponse.mockResolvedValue(
      new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder()
          controller.enqueue(encoder.encode('data: {"type":"done"}\n\n'))
          controller.close()
        },
      })
    )

    const request = new Request('http://localhost/api/personas/1/query', {
      method: 'POST',
      body: JSON.stringify({ question: 'Tell me about databases' }),
    })

    const response = await POST(request, { params: Promise.resolve({ id: '1' }) })
    const reader = response.body!.getReader()
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

    const handoffEvent = events.find(e => e['type'] === 'handoff')
    expect(handoffEvent).toMatchObject({
      type: 'handoff',
      personaId: 2,
      personaName: 'Other Creator',
    })
    // streamPersonaResponse is called WITHOUT handoff param (route owns emission)
    expect(mockStreamPersonaResponse).not.toHaveBeenCalledWith(
      expect.objectContaining({ handoff: expect.anything() }),
    )
  })
})
