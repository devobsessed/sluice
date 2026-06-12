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

import { rewriteFollowUpQuery } from '@/lib/personas/query-rewrite'

const mockDb = vi.mocked(db)
const mockGetPersonaContext = vi.mocked(getPersonaContext)
const mockStreamPersonaResponse = vi.mocked(streamPersonaResponse)
const mockRewriteFollowUpQuery = vi.mocked(rewriteFollowUpQuery)

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

  beforeEach(() => {
    vi.clearAllMocks()

    // Default mock: successful persona lookup
    mockDb.select = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([mockPersona]),
    })

    // Default mock: return empty context
    mockGetPersonaContext.mockResolvedValue([])

    // Default mock: rewrite passes question through unchanged (no-trigger / first question)
    mockRewriteFollowUpQuery.mockImplementation(
      async ({ question }: { question: string }) => question,
    )

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
})
