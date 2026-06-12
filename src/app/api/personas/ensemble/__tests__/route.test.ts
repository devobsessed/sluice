import { describe, it, expect, beforeEach, vi } from 'vitest'
import { POST } from '../route'
import { db } from '@/lib/db'
import { findBestPersonas, streamEnsembleResponse } from '@/lib/personas/ensemble'
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

vi.mock('@/lib/personas/ensemble', () => ({
  findBestPersonas: vi.fn(),
  streamEnsembleResponse: vi.fn(),
}))

const mockDb = vi.mocked(db)
const mockFindBestPersonas = vi.mocked(findBestPersonas)
const mockStreamEnsembleResponse = vi.mocked(streamEnsembleResponse)

describe('POST /api/personas/ensemble', () => {
  const mockPersonas: Persona[] = [
    {
      id: 1,
      channelName: 'ThePrimeagen',
      name: 'ThePrimeagen',
      systemPrompt: 'You are ThePrimeagen.',
      expertiseTopics: ['vim', 'performance'],
      expertiseEmbedding: Array.from({ length: 384 }, () => 0.1),
      transcriptCount: 50,
      regeneratingAt: null,
      lastRegeneratedAt: null,
      createdAt: new Date(),
    },
    {
      id: 2,
      channelName: 'Fireship',
      name: 'Fireship',
      systemPrompt: 'You are Fireship.',
      expertiseTopics: ['react', 'javascript'],
      expertiseEmbedding: Array.from({ length: 384 }, () => 0.2),
      transcriptCount: 40,
      regeneratingAt: null,
      lastRegeneratedAt: null,
      createdAt: new Date(),
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()

    // Default mock: successful personas lookup
    mockDb.select = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue(mockPersonas),
    })

    // Default mock: return best personas with scores
    mockFindBestPersonas.mockResolvedValue([
      { persona: mockPersonas[0]!, score: 0.85 },
      { persona: mockPersonas[1]!, score: 0.75 },
    ])

    // Default mock: return streaming response
    mockStreamEnsembleResponse.mockResolvedValue(
      new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder()
          controller.enqueue(encoder.encode('data: {"type":"best_match","personaId":1}\n\n'))
          controller.enqueue(encoder.encode('data: {"type":"all_done"}\n\n'))
          controller.close()
        },
      })
    )
  })

  it('should return 400 if request body is invalid', async () => {
    const request = new Request('http://localhost/api/personas/ensemble', {
      method: 'POST',
      body: JSON.stringify({}), // Missing question
    })

    const response = await POST(request)

    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toBeTruthy()
  })

  it('should return 400 if question is empty', async () => {
    const request = new Request('http://localhost/api/personas/ensemble', {
      method: 'POST',
      body: JSON.stringify({ question: '' }),
    })

    const response = await POST(request)

    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toBeTruthy()
  })

  it('should return 400 if question is not a string', async () => {
    const request = new Request('http://localhost/api/personas/ensemble', {
      method: 'POST',
      body: JSON.stringify({ question: 123 }),
    })

    const response = await POST(request)

    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toBeTruthy()
  })

  it('should return 400 if personaIds is not an array', async () => {
    const request = new Request('http://localhost/api/personas/ensemble', {
      method: 'POST',
      body: JSON.stringify({ question: 'What is React?', personaIds: 'invalid' }),
    })

    const response = await POST(request)

    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toBeTruthy()
  })

  it('should return 400 if personaIds contains non-numbers', async () => {
    const request = new Request('http://localhost/api/personas/ensemble', {
      method: 'POST',
      body: JSON.stringify({ question: 'What is React?', personaIds: [1, 'two', 3] }),
    })

    const response = await POST(request)

    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toBeTruthy()
  })

  it('should return 400 if malformed JSON', async () => {
    const request = new Request('http://localhost/api/personas/ensemble', {
      method: 'POST',
      body: 'invalid json',
    })

    const response = await POST(request)

    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toBeTruthy()
  })

  it('should return SSE stream if no personas found in database', async () => {
    // Mock empty result
    mockDb.select = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    })

    const request = new Request('http://localhost/api/personas/ensemble', {
      method: 'POST',
      body: JSON.stringify({ question: 'What is React?' }),
    })

    const response = await POST(request)

    // Returns SSE stream with all_done event (not 404) for empty personas
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/event-stream')
  })

  it('should return 404 with specific message if personas exist but have no expertise embeddings', async () => {
    // Mock findBestPersonas returning empty (happens when personas lack embeddings)
    mockFindBestPersonas.mockResolvedValueOnce([])

    const request = new Request('http://localhost/api/personas/ensemble', {
      method: 'POST',
      body: JSON.stringify({ question: 'What is React?' }),
    })

    const response = await POST(request)

    expect(response.status).toBe(404)
    const data = await response.json()
    expect(data.error).toBe('No personas available. Create personas from channels with 5+ transcripts.')
  })

  it('should return SSE stream with all_done if specified personaIds not found', async () => {
    // Mock empty result for specific IDs
    mockDb.select = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    })

    const request = new Request('http://localhost/api/personas/ensemble', {
      method: 'POST',
      body: JSON.stringify({ question: 'What is React?', personaIds: [999, 888] }),
    })

    const response = await POST(request)

    // Returns SSE stream with all_done event (not 404) for empty personas
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/event-stream')
  })

  it('should return streaming response for valid request', async () => {
    const request = new Request('http://localhost/api/personas/ensemble', {
      method: 'POST',
      body: JSON.stringify({ question: 'What is React?' }),
    })

    const response = await POST(request)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/event-stream')
    expect(response.headers.get('cache-control')).toBe('no-cache')
    expect(response.headers.get('connection')).toBe('keep-alive')
  })

  it('should fetch all personas if no personaIds specified', async () => {
    const request = new Request('http://localhost/api/personas/ensemble', {
      method: 'POST',
      body: JSON.stringify({ question: 'What is React?' }),
    })

    await POST(request)

    // Should have called select to fetch personas
    expect(mockDb.select).toHaveBeenCalled()
    // findBestPersonas should have been called with all mock personas
    expect(mockFindBestPersonas).toHaveBeenCalledWith('What is React?', mockPersonas, 3)
  })

  it('should fetch specific personas if personaIds provided', async () => {
    mockDb.select = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([mockPersonas[0]!]),
    })

    const request = new Request('http://localhost/api/personas/ensemble', {
      method: 'POST',
      body: JSON.stringify({ question: 'What is React?', personaIds: [1] }),
    })

    await POST(request)

    // Should have called select to fetch specific personas
    expect(mockDb.select).toHaveBeenCalled()
    // findBestPersonas should have been called with the filtered persona
    expect(mockFindBestPersonas).toHaveBeenCalledWith('What is React?', [mockPersonas[0]!], 3)
  })

  it('should call findBestPersonas to rank personas', async () => {
    const request = new Request('http://localhost/api/personas/ensemble', {
      method: 'POST',
      body: JSON.stringify({ question: 'What is React?' }),
    })

    await POST(request)

    expect(mockFindBestPersonas).toHaveBeenCalledWith('What is React?', mockPersonas, 3)
  })

  it('should limit to top 3 personas by default', async () => {
    const request = new Request('http://localhost/api/personas/ensemble', {
      method: 'POST',
      body: JSON.stringify({ question: 'What is React?' }),
    })

    await POST(request)

    expect(mockFindBestPersonas).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      3 // Default limit
    )
  })

  it('should call streamEnsembleResponse with best personas', async () => {
    const request = new Request('http://localhost/api/personas/ensemble', {
      method: 'POST',
      body: JSON.stringify({ question: 'What is React?' }),
    })

    await POST(request)

    expect(mockStreamEnsembleResponse).toHaveBeenCalledWith({
      question: 'What is React?',
      personas: [mockPersonas[0]!, mockPersonas[1]!],
      signal: expect.any(AbortSignal),
    })
  })

  it('should handle questions with special characters', async () => {
    const request = new Request('http://localhost/api/personas/ensemble', {
      method: 'POST',
      body: JSON.stringify({ question: "What's the difference between 'let' and 'const'?" }),
    })

    const response = await POST(request)

    expect(response.status).toBe(200)
  })

  it('should return 500 if streaming fails', async () => {
    mockStreamEnsembleResponse.mockRejectedValueOnce(new Error('API error'))

    const request = new Request('http://localhost/api/personas/ensemble', {
      method: 'POST',
      body: JSON.stringify({ question: 'What is React?' }),
    })

    const response = await POST(request)

    expect(response.status).toBe(500)
    const data = await response.json()
    expect(data.error).toBeTruthy()
  })

  it('should return 500 with specific message if findBestPersonas fails with embedding error', async () => {
    mockFindBestPersonas.mockRejectedValueOnce(new Error('Failed to generate embedding'))

    const request = new Request('http://localhost/api/personas/ensemble', {
      method: 'POST',
      body: JSON.stringify({ question: 'What is React?' }),
    })

    const response = await POST(request)

    expect(response.status).toBe(500)
    const data = await response.json()
    expect(data.error).toBe('Unable to process your question. Please try again.')
  })

  it('should return 500 with specific message for generic findBestPersonas errors', async () => {
    mockFindBestPersonas.mockRejectedValueOnce(new Error('Database connection failed'))

    const request = new Request('http://localhost/api/personas/ensemble', {
      method: 'POST',
      body: JSON.stringify({ question: 'What is React?' }),
    })

    const response = await POST(request)

    expect(response.status).toBe(500)
    const data = await response.json()
    expect(data.error).toBe('Database connection failed')
  })

  it('should limit personas query to avoid fetching too many', async () => {
    const request = new Request('http://localhost/api/personas/ensemble', {
      method: 'POST',
      body: JSON.stringify({ question: 'What is React?' }),
    })

    await POST(request)

    // Should have called select to fetch personas
    expect(mockDb.select).toHaveBeenCalled()
    // findBestPersonas limits to 3, so that's the effective limit
    expect(mockFindBestPersonas).toHaveBeenCalledWith(expect.any(String), expect.any(Array), 3)
  })

  it('should handle empty personaIds array', async () => {
    mockDb.select = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    })

    const request = new Request('http://localhost/api/personas/ensemble', {
      method: 'POST',
      body: JSON.stringify({ question: 'What is React?', personaIds: [] }),
    })

    const response = await POST(request)

    // Returns SSE stream with all_done event (not 404) for empty personaIds
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/event-stream')
  })
})
