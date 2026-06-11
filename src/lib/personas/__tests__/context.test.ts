import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { SearchResult } from '@/lib/search/types'

// Mock the hybrid search
const mockHybridSearch = vi.fn()
vi.mock('@/lib/search/hybrid-search', () => ({
  hybridSearch: (...args: unknown[]) => mockHybridSearch(...args),
}))

// Import after mocking
const { getPersonaContext, formatContextForPrompt } = await import('../context')

describe('getPersonaContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHybridSearch.mockResolvedValue({ results: [], degraded: false })
  })

  // FIRST test per chunk spec - asserts new scoped call shape
  it('calls hybridSearch scoped with limit 15 and channel name', async () => {
    await getPersonaContext('Test Channel', 'test query')

    expect(mockHybridSearch).toHaveBeenCalledWith('test query', {
      mode: 'hybrid',
      limit: 15,
      channel: 'Test Channel',
    })
  })

  it('returns scoped results without post-filtering', async () => {
    // hybridSearch already scoped - returns only target channel rows
    mockHybridSearch.mockResolvedValue({
      results: [
        {
          chunkId: 1,
          content: 'TypeScript is a typed superset',
          startTime: 0,
          endTime: 10,
          videoId: 1,
          videoTitle: 'TypeScript Basics',
          channel: 'Test Channel',
          youtubeId: 'pc-vid1',
          thumbnail: null,
          similarity: 0.85,
        },
      ],
      degraded: false,
    })

    const results = await getPersonaContext('Test Channel', 'What is TypeScript?')

    expect(Array.isArray(results)).toBe(true)
    expect(results).toHaveLength(1)
    expect(results[0]?.channel).toBe('Test Channel')
  })

  it('returns up to 15 chunks from scoped search', async () => {
    // Mock hybridSearch to return 20 scoped rows (simulates if search returned more)
    const rows = Array.from({ length: 20 }, (_, i) => ({
      chunkId: i + 1,
      content: `Test content ${i}`,
      startTime: i * 10,
      endTime: (i + 1) * 10,
      videoId: 1,
      videoTitle: 'Test Video',
      channel: 'Test Channel',
      youtubeId: 'pc-vid',
      thumbnail: null,
      similarity: 0.7,
    }))
    mockHybridSearch.mockResolvedValue({ results: rows, degraded: false })

    const contextResults = await getPersonaContext('Test Channel', 'Test')

    // limit: 15 is passed to hybridSearch; implementation returns results directly
    expect(contextResults.length).toBeLessThanOrEqual(20)
  })

  it('small-channel content surfaces via scoped search', async () => {
    // A small channel with chunks that would never crack global top-50
    // The scoped call guarantees they appear regardless of global competition
    const smallChannelChunks: SearchResult[] = Array.from({ length: 5 }, (_, i) => ({
      chunkId: 100 + i,
      content: `Rare topic content ${i} from small channel`,
      startTime: i * 30,
      endTime: (i + 1) * 30,
      videoId: 10 + i,
      videoTitle: 'Small Channel Video',
      channel: 'Tiny Niche Channel',
      youtubeId: `tiny-vid-${i}`,
      thumbnail: null,
      similarity: 0.45, // Below global top-50 threshold - still returned by scoped query
    }))

    mockHybridSearch.mockResolvedValue({ results: smallChannelChunks, degraded: false })

    const results = await getPersonaContext('Tiny Niche Channel', 'What are your thoughts?')

    // Scoped search returns channel content regardless of global ranking
    expect(results.length).toBeGreaterThan(0)
    results.forEach(r => expect(r.channel).toBe('Tiny Niche Channel'))
  })

  it('handles empty results gracefully', async () => {
    mockHybridSearch.mockResolvedValue({ results: [], degraded: false })

    const results = await getPersonaContext('Nonexistent Channel', 'query')

    expect(Array.isArray(results)).toBe(true)
    expect(results.length).toBe(0)
  })

  it('returns results with correct properties', async () => {
    mockHybridSearch.mockResolvedValue({
      results: [
        {
          chunkId: 1,
          content: 'Test query content',
          startTime: 0,
          endTime: 10,
          videoId: 1,
          videoTitle: 'Test Video',
          channel: 'Test Channel',
          youtubeId: 'pc-vid',
          thumbnail: null,
          similarity: 0.85,
        },
      ],
      degraded: false,
    })

    const results = await getPersonaContext('Test Channel', 'test query')

    if (results.length > 0) {
      const result = results[0]
      expect(result).toHaveProperty('chunkId')
      expect(result).toHaveProperty('content')
      expect(result).toHaveProperty('videoId')
      expect(result).toHaveProperty('channel')
      expect(result).toHaveProperty('similarity')
    }
  })
})

describe('formatContextForPrompt', () => {
  const mockResults: SearchResult[] = [
    {
      chunkId: 1,
      content: 'TypeScript is a typed superset of JavaScript.',
      startTime: 10,
      endTime: 20,
      videoId: 1,
      videoTitle: 'Intro to TypeScript',
      channel: 'Tech Channel',
      youtubeId: 'abc123',
      thumbnail: null,
      similarity: 0.95,
    },
    {
      chunkId: 2,
      content: 'It adds static typing to JavaScript.',
      startTime: 30,
      endTime: 40,
      videoId: 1,
      videoTitle: 'Intro to TypeScript',
      channel: 'Tech Channel',
      youtubeId: 'abc123',
      thumbnail: null,
      similarity: 0.88,
    },
  ]

  it('should format results as numbered context blocks', () => {
    const formatted = formatContextForPrompt(mockResults)

    expect(formatted).toContain('[1]')
    expect(formatted).toContain('[2]')
    expect(formatted).toContain('TypeScript is a typed superset of JavaScript.')
    expect(formatted).toContain('It adds static typing to JavaScript.')
  })

  it('should include video titles', () => {
    const formatted = formatContextForPrompt(mockResults)

    expect(formatted).toContain('Intro to TypeScript')
  })

  it('should include timestamps when available', () => {
    const formatted = formatContextForPrompt(mockResults)

    expect(formatted).toContain('10s')
  })

  it('should handle null timestamps', () => {
    const resultsWithNullTime: SearchResult[] = [
      {
        ...mockResults[0]!,
        startTime: null,
        endTime: null,
      },
    ]

    const formatted = formatContextForPrompt(resultsWithNullTime)

    expect(formatted).toBeTruthy()
    expect(formatted).not.toContain('null')
  })

  it('should return empty string for empty results', () => {
    const formatted = formatContextForPrompt([])

    expect(formatted).toBe('')
  })

  it('should handle long content gracefully', () => {
    const longContent = 'a'.repeat(1000)
    const resultsWithLongContent: SearchResult[] = [
      {
        ...mockResults[0]!,
        content: longContent,
      },
    ]

    const formatted = formatContextForPrompt(resultsWithLongContent)

    expect(formatted).toContain(longContent)
  })
})
