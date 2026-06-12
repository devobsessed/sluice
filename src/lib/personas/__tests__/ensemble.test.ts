import { describe, it, expect, vi, beforeEach } from 'vitest'
import { findBestPersonas, streamEnsembleResponse } from '../ensemble'
import type { Persona } from '@/lib/db/schema'
import type { SearchResult } from '@/lib/search/types'
import { generateEmbedding } from '@/lib/embeddings/pipeline'
import { getPersonaContext } from '../context'
import { streamPersonaResponse } from '../streaming'

// Mock dependencies
vi.mock('@/lib/embeddings/pipeline', () => ({
  generateEmbedding: vi.fn(),
}))

vi.mock('../context', () => ({
  getPersonaContext: vi.fn(),
}))

vi.mock('../streaming', () => ({
  streamPersonaResponse: vi.fn(),
}))

const mockGenerateEmbedding = vi.mocked(generateEmbedding)
const mockGetPersonaContext = vi.mocked(getPersonaContext)
const mockStreamPersonaResponse = vi.mocked(streamPersonaResponse)

describe('findBestPersonas', () => {
  const mockEmbedding = new Float32Array(384).fill(0.1)

  const mockPersonas: Persona[] = [
    {
      id: 1,
      channelName: 'ThePrimeagen',
      name: 'ThePrimeagen',
      systemPrompt: 'You are ThePrimeagen.',
      expertiseTopics: ['vim', 'performance'],
      expertiseEmbedding: Array.from({ length: 384 }, (_, i) => i === 0 ? 1 : 0),
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
      expertiseEmbedding: Array.from({ length: 384 }, (_, i) => i === 1 ? 1 : 0),
      transcriptCount: 40,
      regeneratingAt: null,
      lastRegeneratedAt: null,
      createdAt: new Date(),
    },
    {
      id: 3,
      channelName: 'NoEmbedding',
      name: 'NoEmbedding',
      systemPrompt: 'You are NoEmbedding.',
      expertiseTopics: ['general'],
      expertiseEmbedding: null,
      transcriptCount: 30,
      regeneratingAt: null,
      lastRegeneratedAt: null,
      createdAt: new Date(),
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    mockGenerateEmbedding.mockResolvedValue(mockEmbedding)
  })

  it('should generate embedding for the question', async () => {
    await findBestPersonas('What is React?', mockPersonas)

    expect(mockGenerateEmbedding).toHaveBeenCalledWith('What is React?')
  })

  it('should return personas sorted by similarity score', async () => {
    const result = await findBestPersonas('What is React?', mockPersonas)

    // Should have 2 personas (excluding one without embedding)
    expect(result).toHaveLength(2)

    // Each result should have persona and score
    expect(result[0]).toHaveProperty('persona')
    expect(result[0]).toHaveProperty('score')
    expect(typeof result[0]?.score).toBe('number')
  })

  it('should skip personas without expertise embeddings', async () => {
    const result = await findBestPersonas('What is React?', mockPersonas)

    // Should only include personas with embeddings
    const hasNullEmbedding = result.some(r => r.persona.id === 3)
    expect(hasNullEmbedding).toBe(false)
  })

  it('should limit results to specified limit', async () => {
    const result = await findBestPersonas('What is React?', mockPersonas, 1)

    expect(result).toHaveLength(1)
  })

  it('should return empty array if no personas provided', async () => {
    const result = await findBestPersonas('What is React?', [])

    expect(result).toEqual([])
  })

  it('should return empty array if no personas have embeddings', async () => {
    const personasWithoutEmbeddings = mockPersonas.map(p => ({
      ...p,
      expertiseEmbedding: null,
    }))

    const result = await findBestPersonas('What is React?', personasWithoutEmbeddings)

    expect(result).toEqual([])
  })

  it('should handle questions with empty string', async () => {
    await findBestPersonas('', mockPersonas)

    expect(mockGenerateEmbedding).toHaveBeenCalledWith('')
  })

  it('should default limit to 3', async () => {
    const manyPersonas = Array.from({ length: 10 }, (_, i) => ({
      ...mockPersonas[0]!,
      id: i,
      channelName: `Channel${i}`,
      expertiseEmbedding: Array.from({ length: 384 }, () => Math.random()),
    }))

    const result = await findBestPersonas('What is React?', manyPersonas)

    expect(result.length).toBeLessThanOrEqual(3)
  })

  it('retries embedding once and succeeds on second attempt', async () => {
    mockGenerateEmbedding
      .mockRejectedValueOnce(new Error('protobuf parsing failed'))
      .mockResolvedValueOnce(new Float32Array(384).fill(0.1))

    const result = await findBestPersonas('What is React?', mockPersonas)

    expect(mockGenerateEmbedding).toHaveBeenCalledTimes(2)
    expect(result.length).toBeGreaterThan(0)
  })

  it('returns empty array when both embedding attempts fail', async () => {
    mockGenerateEmbedding
      .mockRejectedValueOnce(new Error('protobuf parsing failed'))
      .mockRejectedValueOnce(new Error('protobuf parsing failed'))

    const result = await findBestPersonas('What is React?', mockPersonas)

    expect(result).toEqual([])
  })
})

describe('streamEnsembleResponse', () => {
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

  const mockContext: SearchResult[] = [
    {
      chunkId: 1,
      content: 'React is a JavaScript library.',
      startTime: 10,
      endTime: 20,
      videoId: 1,
      videoTitle: 'Intro to React',
      channel: 'Fireship',
      youtubeId: 'abc123',
      thumbnail: null,
      similarity: 0.95,
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()

    mockGenerateEmbedding.mockResolvedValue(new Float32Array(384).fill(0.1))
    mockGetPersonaContext.mockResolvedValue(mockContext)

    // Mock streaming response for each persona - create fresh stream each time
    mockStreamPersonaResponse.mockImplementation(() =>
      Promise.resolve(
        new ReadableStream({
          start(controller) {
            const encoder = new TextEncoder()
            controller.enqueue(encoder.encode('data: {"type":"content_block_delta","delta":{"text":"Hello"}}\n\n'))
            controller.enqueue(encoder.encode('data: {"type":"message_stop"}\n\n'))
            controller.close()
          },
        })
      )
    )
  })

  it('should return a ReadableStream', async () => {
    const stream = await streamEnsembleResponse({
      question: 'What is React?',
      personas: mockPersonas,
    })

    expect(stream).toBeInstanceOf(ReadableStream)
  })

  it('should emit best_match event first', async () => {
    const stream = await streamEnsembleResponse({
      question: 'What is React?',
      personas: mockPersonas,
    })

    const reader = stream.getReader()
    const decoder = new TextDecoder()

    const { value } = await reader.read()
    const text = decoder.decode(value)

    expect(text).toContain('best_match')
    expect(text).toContain('personaId')
    expect(text).toContain('personaName')
    expect(text).toContain('score')

    await reader.cancel()
  })

  it('should emit persona_start events for each persona', async () => {
    const stream = await streamEnsembleResponse({
      question: 'What is React?',
      personas: mockPersonas,
    })

    const reader = stream.getReader()
    const decoder = new TextDecoder()
    const events: string[] = []

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      events.push(decoder.decode(value))
    }

    const allText = events.join('')
    const personaStartCount = (allText.match(/persona_start/g) || []).length

    expect(personaStartCount).toBe(mockPersonas.length)
  })

  it('should emit delta events with personaId', async () => {
    const stream = await streamEnsembleResponse({
      question: 'What is React?',
      personas: mockPersonas,
    })

    const reader = stream.getReader()
    const decoder = new TextDecoder()
    const events: string[] = []

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      events.push(decoder.decode(value))
    }

    const allText = events.join('')

    // Should have delta events
    expect(allText).toContain('delta')

    // Delta events should have personaId
    const deltaMatch = allText.match(/"type":"delta"[^}]*"personaId":\d+/)
    expect(deltaMatch).toBeTruthy()
  })

  it('should emit persona_done events for each persona', async () => {
    const stream = await streamEnsembleResponse({
      question: 'What is React?',
      personas: mockPersonas,
    })

    const reader = stream.getReader()
    const decoder = new TextDecoder()
    const events: string[] = []

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      events.push(decoder.decode(value))
    }

    const allText = events.join('')
    const personaDoneCount = (allText.match(/persona_done/g) || []).length

    expect(personaDoneCount).toBe(mockPersonas.length)
  })

  it('should emit all_done event at the end', async () => {
    const stream = await streamEnsembleResponse({
      question: 'What is React?',
      personas: mockPersonas,
    })

    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let lastEvent = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      lastEvent = decoder.decode(value)
    }

    expect(lastEvent).toContain('all_done')
  })

  it('should fetch context for each persona channel', async () => {
    const stream = await streamEnsembleResponse({
      question: 'What is React?',
      personas: mockPersonas,
    })
    const reader = stream.getReader()
    while (true) {
      const { done } = await reader.read()
      if (done) break
    }

    expect(mockGetPersonaContext).toHaveBeenCalledWith('ThePrimeagen', 'What is React?')
    expect(mockGetPersonaContext).toHaveBeenCalledWith('Fireship', 'What is React?')
  })

  it('should call streamPersonaResponse for each persona', async () => {
    const stream = await streamEnsembleResponse({
      question: 'What is React?',
      personas: mockPersonas,
    })

    const reader = stream.getReader()
    while (true) {
      const { done } = await reader.read()
      if (done) break
    }

    expect(mockStreamPersonaResponse).toHaveBeenCalledTimes(mockPersonas.length)
  })

  it('should handle abort signal', async () => {
    const abortController = new AbortController()
    abortController.abort()

    const stream = await streamEnsembleResponse({
      question: 'What is React?',
      personas: mockPersonas,
      signal: abortController.signal,
    })

    const reader = stream.getReader()

    // Stream should handle cancellation
    await expect(async () => {
      while (true) {
        const { done } = await reader.read()
        if (done) break
      }
    }).rejects.toThrow()
  })

  it('should emit persona_error if one stream fails', async () => {
    // Mock one persona to fail
    mockStreamPersonaResponse
      .mockResolvedValueOnce(
        new ReadableStream({
          start(controller) {
            controller.error(new Error('API error'))
          },
        })
      )
      .mockResolvedValueOnce(
        new ReadableStream({
          start(controller) {
            const encoder = new TextEncoder()
            controller.enqueue(encoder.encode('data: {"type":"content_block_delta","delta":{"text":"Success"}}\n\n'))
            controller.close()
          },
        })
      )

    const stream = await streamEnsembleResponse({
      question: 'What is React?',
      personas: mockPersonas,
    })

    const reader = stream.getReader()
    const decoder = new TextDecoder()
    const events: string[] = []

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      events.push(decoder.decode(value))
    }

    const allText = events.join('')

    // Should have error event for failed persona
    expect(allText).toContain('persona_error')
  })

  it('should handle empty personas array', async () => {
    const stream = await streamEnsembleResponse({
      question: 'What is React?',
      personas: [],
    })

    const reader = stream.getReader()
    const decoder = new TextDecoder()
    const events: string[] = []

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      events.push(decoder.decode(value))
    }

    const allText = events.join('')

    // Should emit all_done immediately
    expect(allText).toContain('all_done')
  })

  it('should include sources in persona_done event', async () => {
    const stream = await streamEnsembleResponse({
      question: 'What is React?',
      personas: [mockPersonas[0]!],
    })

    const reader = stream.getReader()
    const decoder = new TextDecoder()
    const events: string[] = []

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      events.push(decoder.decode(value))
    }

    const allText = events.join('')

    // Should have sources event before persona_done
    expect(allText).toContain('sources')
    expect(allText).toMatch(/sources[\s\S]*persona_done/)
  })
})
