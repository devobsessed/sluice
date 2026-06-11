import { describe, it, expect, beforeEach, vi } from 'vitest'
import { vectorSearch, searchByQuery } from '../vector-search'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type * as schema from '@/lib/db/schema'

// Mock the embedding pipeline to avoid ONNX runtime issues in tests
vi.mock('@/lib/embeddings/pipeline', () => ({
  generateEmbedding: vi.fn().mockResolvedValue(new Float32Array(384).fill(0.5)),
}))

const createMockDb = () => {
  const mockSelectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    innerJoin: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
  }
  const mockInsertChain = {
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
  }
  const mockDeleteChain = {
    where: vi.fn().mockResolvedValue([]),
  }
  return {
    select: vi.fn(() => mockSelectChain),
    insert: vi.fn(() => mockInsertChain),
    delete: vi.fn(() => mockDeleteChain),
    execute: vi.fn().mockResolvedValue({ rows: [] }),
    _selectChain: mockSelectChain,
    _insertChain: mockInsertChain,
    _deleteChain: mockDeleteChain,
  }
}

type MockDb = ReturnType<typeof createMockDb>

describe('vectorSearch', () => {
  let mockDb: MockDb

  beforeEach(() => {
    vi.clearAllMocks()
    mockDb = createMockDb()
  })

  describe('basic vector search', () => {
    it('returns empty array when no chunks exist', async () => {
      mockDb._selectChain.limit.mockResolvedValue([])

      const queryEmbedding = new Array(384).fill(0.1)
      const results = await vectorSearch(
        queryEmbedding,
        10,
        0.3,
        mockDb as unknown as NodePgDatabase<typeof schema>,
      )

      expect(results).toEqual([])
    })

    it('returns empty array when no chunks have embeddings', async () => {
      // WHERE clause filters out null embeddings, so no results
      mockDb._selectChain.limit.mockResolvedValue([])

      const queryEmbedding = new Array(384).fill(0.1)
      const results = await vectorSearch(
        queryEmbedding,
        10,
        0.3,
        mockDb as unknown as NodePgDatabase<typeof schema>,
      )

      expect(results).toEqual([])
    })

    it('returns chunks ordered by similarity score', async () => {
      mockDb._selectChain.limit.mockResolvedValue([
        {
          chunkId: 1,
          content: 'Most relevant chunk',
          startTime: 0,
          endTime: 10,
          similarity: 0.95,
          videoId: 1,
          videoTitle: 'Test Video',
          channel: 'Test Channel',
          youtubeId: 'vs-test-vid',
          thumbnail: 'https://example.com/thumb.jpg',
          publishedAt: null,
        },
        {
          chunkId: 3,
          content: 'Somewhat relevant chunk',
          startTime: 20,
          endTime: 30,
          similarity: 0.65,
          videoId: 1,
          videoTitle: 'Test Video',
          channel: 'Test Channel',
          youtubeId: 'vs-test-vid',
          thumbnail: 'https://example.com/thumb.jpg',
          publishedAt: null,
        },
        {
          chunkId: 2,
          content: 'Least relevant chunk',
          startTime: 10,
          endTime: 20,
          similarity: 0.45,
          videoId: 1,
          videoTitle: 'Test Video',
          channel: 'Test Channel',
          youtubeId: 'vs-test-vid',
          thumbnail: 'https://example.com/thumb.jpg',
          publishedAt: null,
        },
      ])

      const queryEmbedding = new Array(384).fill(0).map((_, i) => i % 2 === 0 ? 1 : 0)
      const results = await vectorSearch(
        queryEmbedding,
        10,
        0.3,
        mockDb as unknown as NodePgDatabase<typeof schema>,
      )

      expect(results.length).toBeGreaterThan(0)
      expect(results[0]?.content).toBe('Most relevant chunk')
      const lastResult = results[results.length - 1]
      expect(lastResult?.content).toBe('Least relevant chunk')
    })
  })

  describe('similarity threshold', () => {
    it('filters out results below threshold', async () => {
      mockDb._selectChain.limit.mockResolvedValue([
        {
          chunkId: 1,
          content: 'High similarity',
          startTime: 0,
          endTime: 10,
          similarity: 0.98,
          videoId: 1,
          videoTitle: 'Test Video',
          channel: 'Test Channel',
          youtubeId: 'vs-test-vid',
          thumbnail: null,
          publishedAt: null,
        },
        {
          chunkId: 2,
          content: 'Low similarity',
          startTime: 10,
          endTime: 20,
          similarity: 0.5,
          videoId: 1,
          videoTitle: 'Test Video',
          channel: 'Test Channel',
          youtubeId: 'vs-test-vid',
          thumbnail: null,
          publishedAt: null,
        },
      ])

      const queryEmbedding = new Array(384).fill(0).map((_, i) => i % 2 === 0 ? 1 : 0)
      const results = await vectorSearch(
        queryEmbedding,
        10,
        0.95,
        mockDb as unknown as NodePgDatabase<typeof schema>,
      )

      expect(results).toHaveLength(1)
      expect(results[0]?.content).toBe('High similarity')
    })

    it('uses default threshold of 0.3', async () => {
      mockDb._selectChain.limit.mockResolvedValue([
        {
          chunkId: 1,
          content: 'Medium similarity',
          startTime: 0,
          endTime: 10,
          similarity: 0.5,
          videoId: 1,
          videoTitle: 'Test Video',
          channel: 'Test Channel',
          youtubeId: 'vs-test-vid',
          thumbnail: null,
          publishedAt: null,
        },
      ])

      const queryEmbedding = new Array(384).fill(0.5)
      const results = await vectorSearch(
        queryEmbedding,
        10,
        undefined,
        mockDb as unknown as NodePgDatabase<typeof schema>,
      )

      expect(results.length).toBeGreaterThan(0)
    })
  })

  describe('limit parameter', () => {
    it('respects limit parameter', async () => {
      mockDb._selectChain.limit.mockResolvedValue([
        {
          chunkId: 1,
          content: 'Chunk 0',
          startTime: 0,
          endTime: 10,
          similarity: 0.9,
          videoId: 1,
          videoTitle: 'Test Video',
          channel: 'Test Channel',
          youtubeId: 'vs-test-vid',
          thumbnail: null,
          publishedAt: null,
        },
        {
          chunkId: 2,
          content: 'Chunk 1',
          startTime: 10,
          endTime: 20,
          similarity: 0.85,
          videoId: 1,
          videoTitle: 'Test Video',
          channel: 'Test Channel',
          youtubeId: 'vs-test-vid',
          thumbnail: null,
          publishedAt: null,
        },
      ])

      const queryEmbedding = new Array(384).fill(0.8)
      const results = await vectorSearch(
        queryEmbedding,
        2,
        0.3,
        mockDb as unknown as NodePgDatabase<typeof schema>,
      )

      expect(results).toHaveLength(2)
    })

    it('uses default limit of 10', async () => {
      const mockResults = Array.from({ length: 10 }, (_, i) => ({
        chunkId: i + 1,
        content: `Chunk ${i}`,
        startTime: i * 10,
        endTime: (i + 1) * 10,
        similarity: 0.9 - i * 0.01,
        videoId: 1,
        videoTitle: 'Test Video',
        channel: 'Test Channel',
        youtubeId: 'vs-test-vid',
        thumbnail: null,
        publishedAt: null,
      }))

      mockDb._selectChain.limit.mockResolvedValue(mockResults)

      const queryEmbedding = new Array(384).fill(0.8)
      const results = await vectorSearch(
        queryEmbedding,
        undefined,
        0.3,
        mockDb as unknown as NodePgDatabase<typeof schema>,
      )

      expect(results).toHaveLength(10)
    })
  })

  describe('result structure', () => {
    it('includes all required fields in result', async () => {
      mockDb._selectChain.limit.mockResolvedValue([
        {
          chunkId: 1,
          content: 'Test chunk content',
          startTime: 42,
          endTime: 52,
          similarity: 0.92,
          videoId: 1,
          videoTitle: 'Test Video Title',
          channel: 'Test Channel Name',
          youtubeId: 'abc123',
          thumbnail: 'https://example.com/thumb.jpg',
          publishedAt: null,
        },
      ])

      const queryEmbedding = new Array(384).fill(0.8)
      const results = await vectorSearch(
        queryEmbedding,
        10,
        0.3,
        mockDb as unknown as NodePgDatabase<typeof schema>,
      )

      expect(results).toHaveLength(1)

      const result = results[0]!
      expect(result).toHaveProperty('chunkId')
      expect(result).toHaveProperty('content', 'Test chunk content')
      expect(result).toHaveProperty('startTime', 42)
      expect(result).toHaveProperty('endTime', 52)
      expect(result).toHaveProperty('similarity')
      expect(result).toHaveProperty('videoId', 1)
      expect(result).toHaveProperty('videoTitle', 'Test Video Title')
      expect(result).toHaveProperty('channel', 'Test Channel Name')
      expect(result).toHaveProperty('youtubeId', 'abc123')
      expect(result).toHaveProperty('thumbnail', 'https://example.com/thumb.jpg')
    })

    it('normalizes similarity score to 0-1 range', async () => {
      mockDb._selectChain.limit.mockResolvedValue([
        {
          chunkId: 1,
          content: 'Test chunk',
          startTime: 0,
          endTime: 10,
          similarity: 0.85,
          videoId: 1,
          videoTitle: 'Test Video',
          channel: 'Test Channel',
          youtubeId: 'vs-test-vid',
          thumbnail: null,
          publishedAt: null,
        },
      ])

      const queryEmbedding = new Array(384).fill(0.8)
      const results = await vectorSearch(
        queryEmbedding,
        10,
        0.3,
        mockDb as unknown as NodePgDatabase<typeof schema>,
      )

      expect(results[0]?.similarity).toBeGreaterThanOrEqual(0)
      expect(results[0]?.similarity).toBeLessThanOrEqual(1)
    })
  })

  describe('video metadata', () => {
    it('includes video metadata with each chunk', async () => {
      mockDb._selectChain.limit.mockResolvedValue([
        {
          chunkId: 1,
          content: 'Chunk from video 1',
          startTime: 0,
          endTime: 10,
          similarity: 0.9,
          videoId: 1,
          videoTitle: 'Video One',
          channel: 'Channel A',
          youtubeId: 'vs-vid1',
          thumbnail: 'https://example.com/thumb1.jpg',
          publishedAt: null,
        },
        {
          chunkId: 2,
          content: 'Chunk from video 2',
          startTime: 0,
          endTime: 10,
          similarity: 0.85,
          videoId: 2,
          videoTitle: 'Video Two',
          channel: 'Channel B',
          youtubeId: 'vs-vid2',
          thumbnail: 'https://example.com/thumb2.jpg',
          publishedAt: null,
        },
      ])

      const queryEmbedding = new Array(384).fill(0.8)
      const results = await vectorSearch(
        queryEmbedding,
        10,
        0.3,
        mockDb as unknown as NodePgDatabase<typeof schema>,
      )

      expect(results).toHaveLength(2)

      const result1 = results.find(r => r.videoId === 1)
      expect(result1?.videoTitle).toBe('Video One')
      expect(result1?.channel).toBe('Channel A')
      expect(result1?.youtubeId).toBe('vs-vid1')
      expect(result1?.thumbnail).toBe('https://example.com/thumb1.jpg')

      const result2 = results.find(r => r.videoId === 2)
      expect(result2?.videoTitle).toBe('Video Two')
      expect(result2?.channel).toBe('Channel B')
      expect(result2?.youtubeId).toBe('vs-vid2')
      expect(result2?.thumbnail).toBe('https://example.com/thumb2.jpg')
    })
  })

  describe('input validation', () => {
    it('throws TypeError for invalid embedding dimension', async () => {
      const badEmbedding = new Array(100).fill(0.5)

      await expect(
        vectorSearch(
          badEmbedding,
          10,
          0.3,
          mockDb as unknown as NodePgDatabase<typeof schema>,
        ),
      ).rejects.toThrow(TypeError)
    })

    it('throws TypeError for non-array embedding', async () => {
      await expect(
        vectorSearch(
          'not an array' as unknown as number[],
          10,
          0.3,
          mockDb as unknown as NodePgDatabase<typeof schema>,
        ),
      ).rejects.toThrow(TypeError)
    })
  })

  describe('channel filter (opt-in)', () => {
    // FIRST test: omitted channel must not change today's WHERE clause shape
    it('omitted channel produces today\'s single-condition WHERE', async () => {
      mockDb._selectChain.limit.mockResolvedValue([])
      const queryEmbedding = new Array(384).fill(0.1)

      await vectorSearch(
        queryEmbedding,
        10,
        0.3,
        mockDb as unknown as NodePgDatabase<typeof schema>,
        // no 5th arg - channel omitted
      )

      // .where() must be called exactly once with a single condition (no `and(...)`)
      expect(mockDb._selectChain.where).toHaveBeenCalledTimes(1)
      const whereArg = mockDb._selectChain.where.mock.calls[0]?.[0] as { queryChunks?: Array<{ value?: string[] }> }
      // drizzle `and()` wraps: first queryChunk is ['(']
      // bare sql`` template: first queryChunk is NOT ['(']
      expect(whereArg).toBeDefined()
      expect(whereArg.queryChunks?.[0]?.value).not.toEqual(['('])
    })

    it('accepts channel argument and returns results unchanged', async () => {
      const scopedRows = [
        {
          chunkId: 1,
          content: 'Small channel content',
          startTime: 0,
          endTime: 10,
          similarity: 0.8,
          videoId: 1,
          videoTitle: 'Tiny Creator Video',
          channel: 'Tiny Creator',
          youtubeId: 'tiny-vid-1',
          thumbnail: null,
          publishedAt: null,
        },
      ]
      mockDb._selectChain.limit.mockResolvedValue(scopedRows)
      const queryEmbedding = new Array(384).fill(0.1)

      const results = await vectorSearch(
        queryEmbedding,
        10,
        0.3,
        mockDb as unknown as NodePgDatabase<typeof schema>,
        'Tiny Creator',
      )

      expect(results).toHaveLength(1)
      expect(results[0]?.channel).toBe('Tiny Creator')
      expect(results[0]?.content).toBe('Small channel content')
    })

    it('channel filter uses AND with the embedding-not-null guard', async () => {
      mockDb._selectChain.limit.mockResolvedValue([])
      const queryEmbedding = new Array(384).fill(0.1)

      await vectorSearch(
        queryEmbedding,
        10,
        0.3,
        mockDb as unknown as NodePgDatabase<typeof schema>,
        'Some Channel',
      )

      expect(mockDb._selectChain.where).toHaveBeenCalledTimes(1)
      const whereArg = mockDb._selectChain.where.mock.calls[0]?.[0] as { queryChunks?: Array<{ value?: string[] }> }
      // drizzle `and()` wraps its conditions with outer queryChunks: ['(', inner, ')']
      // A bare sql`` tag has 1 queryChunk with the raw template string.
      // Compound: queryChunks[0].value is ['(']
      expect(whereArg).toBeDefined()
      expect(whereArg.queryChunks?.[0]?.value).toEqual(['('])
    })

    it('null channel is treated identically to omitted channel', async () => {
      mockDb._selectChain.limit.mockResolvedValue([])
      const queryEmbedding = new Array(384).fill(0.1)

      await vectorSearch(
        queryEmbedding,
        10,
        0.3,
        mockDb as unknown as NodePgDatabase<typeof schema>,
        null,
      )

      expect(mockDb._selectChain.where).toHaveBeenCalledTimes(1)
      const whereArg = mockDb._selectChain.where.mock.calls[0]?.[0] as { queryChunks?: Array<{ value?: string[] }> }
      // Single-condition WHERE: first queryChunk is NOT '('
      expect(whereArg.queryChunks?.[0]?.value).not.toEqual(['('])
    })

    it('empty-string channel is treated as omitted (no filter)', async () => {
      mockDb._selectChain.limit.mockResolvedValue([])
      const queryEmbedding = new Array(384).fill(0.1)

      await vectorSearch(
        queryEmbedding,
        10,
        0.3,
        mockDb as unknown as NodePgDatabase<typeof schema>,
        '',
      )

      expect(mockDb._selectChain.where).toHaveBeenCalledTimes(1)
      const whereArg = mockDb._selectChain.where.mock.calls[0]?.[0] as { queryChunks?: Array<{ value?: string[] }> }
      // Single-condition WHERE: first queryChunk is NOT '('
      expect(whereArg.queryChunks?.[0]?.value).not.toEqual(['('])
    })
  })
})

describe('searchByQuery', () => {
  let mockDb: MockDb

  beforeEach(() => {
    vi.clearAllMocks()
    mockDb = createMockDb()
  })

  it('generates embedding and performs vector search', async () => {
    mockDb._selectChain.limit.mockResolvedValue([
      {
        chunkId: 1,
        content: 'TypeScript is a typed superset of JavaScript',
        startTime: 0,
        endTime: 10,
        similarity: 0.85,
        videoId: 1,
        videoTitle: 'TypeScript Tutorial',
        channel: 'Dev Channel',
        youtubeId: 'vs-test-vid',
        thumbnail: null,
        publishedAt: null,
      },
    ])

    const results = await searchByQuery(
      'TypeScript programming',
      5,
      0.1,
      mockDb as unknown as NodePgDatabase<typeof schema>,
    )

    expect(Array.isArray(results)).toBe(true)
  })

  it('handles empty query string', async () => {
    await expect(
      searchByQuery(
        '',
        10,
        0.3,
        mockDb as unknown as NodePgDatabase<typeof schema>,
      ),
    ).rejects.toThrow()
  })

  it('returns empty array when no matching chunks', async () => {
    mockDb._selectChain.limit.mockResolvedValue([])

    const results = await searchByQuery(
      'TypeScript programming',
      5,
      0.9,
      mockDb as unknown as NodePgDatabase<typeof schema>,
    )

    expect(Array.isArray(results)).toBe(true)
  })
})
