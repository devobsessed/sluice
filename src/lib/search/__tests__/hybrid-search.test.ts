import { describe, it, expect, beforeEach, vi } from 'vitest'
import { hybridSearch } from '../hybrid-search'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type * as schema from '@/lib/db/schema'

// Mock the embedding pipeline to avoid ONNX runtime issues in tests
vi.mock('@/lib/embeddings/pipeline', () => ({
  generateEmbedding: vi.fn().mockResolvedValue(new Float32Array(384).fill(0.5)),
}))

// Mock vector-search module so hybrid mode can be tested independently
vi.mock('../vector-search', () => ({
  vectorSearch: vi.fn().mockResolvedValue([]),
}))

import { vectorSearch } from '../vector-search'
import { generateEmbedding } from '@/lib/embeddings/pipeline'

const createMockDb = () => {
  const mockSelectChain = {
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
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

describe('hybridSearch', () => {
  let mockDb: MockDb

  beforeEach(() => {
    vi.clearAllMocks()
    mockDb = createMockDb()
  })

  describe('mode: keyword', () => {
    it('returns chunks matching keyword search', async () => {
      mockDb._selectChain.limit.mockResolvedValue([
        {
          chunkId: 1,
          content: 'TypeScript is a typed superset of JavaScript',
          startTime: 0,
          endTime: 10,
          similarity: '1.0',
          videoId: 1,
          videoTitle: 'Test Video',
          channel: 'Test Channel',
          youtubeId: 'test-vid',
          thumbnail: null,
          publishedAt: null,
        },
      ])

      const { results, degraded } = await hybridSearch(
        'TypeScript',
        { mode: 'keyword', limit: 10 },
        mockDb as unknown as NodePgDatabase<typeof schema>,
      )

      expect(results.length).toBeGreaterThan(0)
      expect(results[0]?.content).toContain('TypeScript')
      expect(degraded).toBe(false)
    })

    it('performs case-insensitive keyword search', async () => {
      mockDb._selectChain.limit.mockResolvedValue([
        {
          chunkId: 1,
          content: 'TypeScript is awesome',
          startTime: 0,
          endTime: 10,
          similarity: '1.0',
          videoId: 1,
          videoTitle: 'Test Video',
          channel: 'Test Channel',
          youtubeId: 'test-vid',
          thumbnail: null,
          publishedAt: null,
        },
      ])

      const { results, degraded } = await hybridSearch(
        'typescript',
        { mode: 'keyword', limit: 10 },
        mockDb as unknown as NodePgDatabase<typeof schema>,
      )

      expect(results.length).toBe(1)
      expect(results[0]?.content).toContain('TypeScript')
      expect(degraded).toBe(false)
    })

    it('returns empty array when no keyword matches', async () => {
      mockDb._selectChain.limit.mockResolvedValue([])

      const { results, degraded } = await hybridSearch(
        'TypeScript',
        { mode: 'keyword', limit: 10 },
        mockDb as unknown as NodePgDatabase<typeof schema>,
      )

      expect(results).toEqual([])
      expect(degraded).toBe(false)
    })

    it('respects limit parameter', async () => {
      mockDb._selectChain.limit.mockResolvedValue([
        {
          chunkId: 1,
          content: 'This is test chunk 0',
          startTime: 0,
          endTime: 10,
          similarity: '1.0',
          videoId: 1,
          videoTitle: 'Test Video',
          channel: 'Test Channel',
          youtubeId: 'test-vid',
          thumbnail: null,
          publishedAt: null,
        },
        {
          chunkId: 2,
          content: 'This is test chunk 1',
          startTime: 10,
          endTime: 20,
          similarity: '1.0',
          videoId: 1,
          videoTitle: 'Test Video',
          channel: 'Test Channel',
          youtubeId: 'test-vid',
          thumbnail: null,
          publishedAt: null,
        },
      ])

      const { results, degraded } = await hybridSearch(
        'test',
        { mode: 'keyword', limit: 2 },
        mockDb as unknown as NodePgDatabase<typeof schema>,
      )

      expect(results).toHaveLength(2)
      expect(degraded).toBe(false)
    })
  })

  describe('mode: vector', () => {
    it('performs pure vector search', async () => {
      vi.mocked(vectorSearch).mockResolvedValue([
        {
          chunkId: 1,
          content: 'Some content here',
          startTime: 0,
          endTime: 10,
          similarity: 0.85,
          videoId: 1,
          videoTitle: 'Test Video',
          channel: 'Test Channel',
          youtubeId: 'test-vid',
          thumbnail: null,
          publishedAt: null,
        },
      ])

      const { results, degraded } = await hybridSearch(
        'query text',
        { mode: 'vector', limit: 10 },
        mockDb as unknown as NodePgDatabase<typeof schema>,
      )

      expect(Array.isArray(results)).toBe(true)
      expect(results.length).toBe(1)
      expect(vectorSearch).toHaveBeenCalled()
      expect(degraded).toBe(false)
    })

    it('returns empty results when vector search finds nothing above threshold', async () => {
      vi.mocked(vectorSearch).mockResolvedValue([])

      const { results, degraded } = await hybridSearch(
        'query',
        { mode: 'vector', limit: 10 },
        mockDb as unknown as NodePgDatabase<typeof schema>,
      )

      expect(Array.isArray(results)).toBe(true)
      expect(results).toEqual([])
      expect(degraded).toBe(false)
    })
  })

  describe('mode: hybrid (RRF)', () => {
    it('combines vector and keyword results using RRF', async () => {
      vi.mocked(vectorSearch).mockResolvedValue([
        {
          chunkId: 1,
          content: 'TypeScript is a typed language',
          startTime: 0,
          endTime: 10,
          similarity: 0.9,
          videoId: 1,
          videoTitle: 'Test Video',
          channel: 'Test Channel',
          youtubeId: 'test-vid',
          thumbnail: null,
          publishedAt: null,
        },
        {
          chunkId: 3,
          content: 'Programming concepts explained',
          startTime: 20,
          endTime: 30,
          similarity: 0.85,
          videoId: 1,
          videoTitle: 'Test Video',
          channel: 'Test Channel',
          youtubeId: 'test-vid',
          thumbnail: null,
          publishedAt: null,
        },
      ])

      mockDb._selectChain.limit.mockResolvedValue([
        {
          chunkId: 1,
          content: 'TypeScript is a typed language',
          startTime: 0,
          endTime: 10,
          similarity: '1.0',
          videoId: 1,
          videoTitle: 'Test Video',
          channel: 'Test Channel',
          youtubeId: 'test-vid',
          thumbnail: null,
          publishedAt: null,
        },
        {
          chunkId: 2,
          content: 'TypeScript tutorial for beginners',
          startTime: 10,
          endTime: 20,
          similarity: '1.0',
          videoId: 1,
          videoTitle: 'Test Video',
          channel: 'Test Channel',
          youtubeId: 'test-vid',
          thumbnail: null,
          publishedAt: null,
        },
      ])

      const { results, degraded } = await hybridSearch(
        'TypeScript',
        { mode: 'hybrid', limit: 10 },
        mockDb as unknown as NodePgDatabase<typeof schema>,
      )

      expect(results.length).toBeGreaterThan(0)
      expect(Array.isArray(results)).toBe(true)
      expect(degraded).toBe(false)
    })

    it('deduplicates chunks appearing in both vector and keyword results', async () => {
      vi.mocked(vectorSearch).mockResolvedValue([
        {
          chunkId: 1,
          content: 'TypeScript programming language',
          startTime: 0,
          endTime: 10,
          similarity: 0.9,
          videoId: 1,
          videoTitle: 'Test Video',
          channel: 'Test Channel',
          youtubeId: 'test-vid',
          thumbnail: null,
          publishedAt: null,
        },
      ])

      mockDb._selectChain.limit.mockResolvedValue([
        {
          chunkId: 1,
          content: 'TypeScript programming language',
          startTime: 0,
          endTime: 10,
          similarity: '1.0',
          videoId: 1,
          videoTitle: 'Test Video',
          channel: 'Test Channel',
          youtubeId: 'test-vid',
          thumbnail: null,
          publishedAt: null,
        },
      ])

      const { results, degraded } = await hybridSearch(
        'TypeScript',
        { mode: 'hybrid', limit: 10 },
        mockDb as unknown as NodePgDatabase<typeof schema>,
      )

      const chunkIds = results.map(r => r.chunkId)
      const uniqueIds = new Set(chunkIds)
      expect(chunkIds.length).toBe(uniqueIds.size)
      expect(degraded).toBe(false)
    })

    it('boosts chunks that appear in both vector and keyword results', async () => {
      vi.mocked(vectorSearch).mockResolvedValue([
        {
          chunkId: 1,
          content: 'TypeScript is amazing',
          startTime: 0,
          endTime: 10,
          similarity: 0.9,
          videoId: 1,
          videoTitle: 'Test Video',
          channel: 'Test Channel',
          youtubeId: 'test-vid',
          thumbnail: null,
          publishedAt: null,
        },
        {
          chunkId: 3,
          content: 'Programming best practices',
          startTime: 20,
          endTime: 30,
          similarity: 0.85,
          videoId: 1,
          videoTitle: 'Test Video',
          channel: 'Test Channel',
          youtubeId: 'test-vid',
          thumbnail: null,
          publishedAt: null,
        },
      ])

      mockDb._selectChain.limit.mockResolvedValue([
        {
          chunkId: 1,
          content: 'TypeScript is amazing',
          startTime: 0,
          endTime: 10,
          similarity: '1.0',
          videoId: 1,
          videoTitle: 'Test Video',
          channel: 'Test Channel',
          youtubeId: 'test-vid',
          thumbnail: null,
          publishedAt: null,
        },
        {
          chunkId: 2,
          content: 'TypeScript tutorial',
          startTime: 10,
          endTime: 20,
          similarity: '1.0',
          videoId: 1,
          videoTitle: 'Test Video',
          channel: 'Test Channel',
          youtubeId: 'test-vid',
          thumbnail: null,
          publishedAt: null,
        },
      ])

      const { results, degraded } = await hybridSearch(
        'TypeScript',
        { mode: 'hybrid', limit: 10 },
        mockDb as unknown as NodePgDatabase<typeof schema>,
      )

      expect(results.length).toBeGreaterThan(0)
      // Chunk 1 (appears in both) should be first due to RRF boost
      expect(results[0]?.chunkId).toBe(1)
      expect(degraded).toBe(false)
    })

    it('respects limit parameter in hybrid mode', async () => {
      const vectorResults = Array.from({ length: 10 }, (_, i) => ({
        chunkId: i + 1,
        content: `TypeScript content ${i}`,
        startTime: i * 10,
        endTime: (i + 1) * 10,
        similarity: 0.9 - i * 0.01,
        videoId: 1,
        videoTitle: 'Test Video',
        channel: 'Test Channel',
        youtubeId: 'test-vid',
        thumbnail: null,
        publishedAt: null,
      }))

      vi.mocked(vectorSearch).mockResolvedValue(vectorResults)

      mockDb._selectChain.limit.mockResolvedValue(
        vectorResults.map(r => ({ ...r, similarity: '1.0' })),
      )

      const { results, degraded } = await hybridSearch(
        'TypeScript',
        { mode: 'hybrid', limit: 5 },
        mockDb as unknown as NodePgDatabase<typeof schema>,
      )

      expect(results.length).toBeLessThanOrEqual(5)
      expect(degraded).toBe(false)
    })
  })

  describe('default behavior', () => {
    it('uses hybrid mode by default', async () => {
      vi.mocked(vectorSearch).mockResolvedValue([])
      mockDb._selectChain.limit.mockResolvedValue([])

      const { results, degraded } = await hybridSearch(
        'TypeScript',
        { limit: 10 },
        mockDb as unknown as NodePgDatabase<typeof schema>,
      )

      expect(Array.isArray(results)).toBe(true)
      expect(vectorSearch).toHaveBeenCalled()
      expect(degraded).toBe(false)
    })

    it('uses limit of 10 by default', async () => {
      vi.mocked(vectorSearch).mockResolvedValue([])
      mockDb._selectChain.limit.mockResolvedValue([])

      const { results, degraded } = await hybridSearch(
        'test',
        {},
        mockDb as unknown as NodePgDatabase<typeof schema>,
      )

      expect(results.length).toBeLessThanOrEqual(10)
      expect(degraded).toBe(false)
    })
  })

  describe('result structure', () => {
    it('returns SearchResult objects with all required fields', async () => {
      mockDb._selectChain.limit.mockResolvedValue([
        {
          chunkId: 1,
          content: 'TypeScript programming',
          startTime: 42,
          endTime: 52,
          similarity: '1.0',
          videoId: 1,
          videoTitle: 'Test Video Title',
          channel: 'Test Channel Name',
          youtubeId: 'abc123',
          thumbnail: 'https://example.com/thumb.jpg',
          publishedAt: null,
        },
      ])

      const { results, degraded } = await hybridSearch(
        'TypeScript',
        { mode: 'keyword' },
        mockDb as unknown as NodePgDatabase<typeof schema>,
      )

      expect(results).toHaveLength(1)

      const result = results[0]!
      expect(result).toHaveProperty('chunkId')
      expect(result).toHaveProperty('content', 'TypeScript programming')
      expect(result).toHaveProperty('startTime', 42)
      expect(result).toHaveProperty('endTime', 52)
      expect(result).toHaveProperty('similarity')
      expect(result).toHaveProperty('videoId', 1)
      expect(result).toHaveProperty('videoTitle', 'Test Video Title')
      expect(result).toHaveProperty('channel', 'Test Channel Name')
      expect(result).toHaveProperty('youtubeId', 'abc123')
      expect(result).toHaveProperty('thumbnail', 'https://example.com/thumb.jpg')
      expect(degraded).toBe(false)
    })

    it('assigns similarity score of 1.0 for keyword matches', async () => {
      mockDb._selectChain.limit.mockResolvedValue([
        {
          chunkId: 1,
          content: 'TypeScript programming',
          startTime: 0,
          endTime: 10,
          similarity: '1.0',
          videoId: 1,
          videoTitle: 'Test Video',
          channel: 'Test Channel',
          youtubeId: 'test-vid',
          thumbnail: null,
          publishedAt: null,
        },
      ])

      const { results, degraded } = await hybridSearch(
        'TypeScript',
        { mode: 'keyword' },
        mockDb as unknown as NodePgDatabase<typeof schema>,
      )

      expect(results[0]?.similarity).toBe(1.0)
      expect(degraded).toBe(false)
    })
  })

  describe('edge cases', () => {
    it('handles empty database', async () => {
      vi.mocked(vectorSearch).mockResolvedValue([])
      mockDb._selectChain.limit.mockResolvedValue([])

      const { results, degraded } = await hybridSearch(
        'anything',
        { mode: 'hybrid' },
        mockDb as unknown as NodePgDatabase<typeof schema>,
      )

      expect(results).toEqual([])
      expect(degraded).toBe(false)
    })

    it('handles query with special characters', async () => {
      mockDb._selectChain.limit.mockResolvedValue([])

      const { results, degraded } = await hybridSearch(
        'C++',
        { mode: 'keyword' },
        mockDb as unknown as NodePgDatabase<typeof schema>,
      )

      expect(results.length).toBeGreaterThanOrEqual(0)
      expect(degraded).toBe(false)
    })

    it('handles partial word matches in keyword search', async () => {
      mockDb._selectChain.limit.mockResolvedValue([
        {
          chunkId: 1,
          content: 'TypeScript programming language',
          startTime: 0,
          endTime: 10,
          similarity: '1.0',
          videoId: 1,
          videoTitle: 'Test Video',
          channel: 'Test Channel',
          youtubeId: 'test-vid',
          thumbnail: null,
          publishedAt: null,
        },
      ])

      const { results, degraded } = await hybridSearch(
        'Type',
        { mode: 'keyword' },
        mockDb as unknown as NodePgDatabase<typeof schema>,
      )

      expect(results.length).toBe(1)
      expect(results[0]?.content).toContain('TypeScript')
      expect(degraded).toBe(false)
    })
  })

  describe('temporal decay', () => {
    it('does not apply decay when temporalDecay is false (default)', async () => {
      const now = new Date()
      const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000)

      mockDb._selectChain.limit.mockResolvedValue([
        {
          chunkId: 1,
          content: 'TypeScript programming old',
          startTime: 0,
          endTime: 10,
          similarity: '1.0',
          videoId: 1,
          videoTitle: 'Old Video',
          channel: 'Test Channel',
          youtubeId: 'old-vid',
          thumbnail: null,
          publishedAt: oneYearAgo,
        },
        {
          chunkId: 2,
          content: 'TypeScript programming new',
          startTime: 0,
          endTime: 10,
          similarity: '1.0',
          videoId: 2,
          videoTitle: 'New Video',
          channel: 'Test Channel',
          youtubeId: 'new-vid',
          thumbnail: null,
          publishedAt: now,
        },
      ])

      const { results, degraded } = await hybridSearch(
        'TypeScript',
        { mode: 'keyword', limit: 10, temporalDecay: false },
        mockDb as unknown as NodePgDatabase<typeof schema>,
      )

      expect(results).toHaveLength(2)
      expect(results[0]?.similarity).toBeCloseTo(results[1]?.similarity ?? 0, 2)
      expect(degraded).toBe(false)
    })

    it('applies temporal decay when temporalDecay is true', async () => {
      const now = new Date()
      const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000)

      mockDb._selectChain.limit.mockResolvedValue([
        {
          chunkId: 1,
          content: 'TypeScript programming',
          startTime: 0,
          endTime: 10,
          similarity: '1.0',
          videoId: 1,
          videoTitle: 'Old Video',
          channel: 'Test Channel',
          youtubeId: 'old-vid',
          thumbnail: null,
          publishedAt: oneYearAgo,
        },
        {
          chunkId: 2,
          content: 'TypeScript programming',
          startTime: 0,
          endTime: 10,
          similarity: '1.0',
          videoId: 2,
          videoTitle: 'New Video',
          channel: 'Test Channel',
          youtubeId: 'new-vid',
          thumbnail: null,
          publishedAt: now,
        },
      ])

      const { results, degraded } = await hybridSearch(
        'TypeScript',
        { mode: 'keyword', limit: 10, temporalDecay: true },
        mockDb as unknown as NodePgDatabase<typeof schema>,
      )

      expect(results).toHaveLength(2)

      const newResult = results.find(r => r.videoId === 2)
      const oldResult = results.find(r => r.videoId === 1)

      expect(newResult).toBeDefined()
      expect(oldResult).toBeDefined()
      expect(newResult!.similarity).toBeGreaterThan(oldResult!.similarity)

      expect(oldResult!.similarity).toBeCloseTo(0.5, 1)
      expect(newResult!.similarity).toBeCloseTo(1.0, 1)
      expect(degraded).toBe(false)
    })

    it('respects custom halfLifeDays parameter', async () => {
      const now = new Date()
      const sixMonthsAgo = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000)

      mockDb._selectChain.limit.mockResolvedValue([
        {
          chunkId: 1,
          content: 'TypeScript programming',
          startTime: 0,
          endTime: 10,
          similarity: '1.0',
          videoId: 1,
          videoTitle: 'Old Video',
          channel: 'Test Channel',
          youtubeId: 'old-vid',
          thumbnail: null,
          publishedAt: sixMonthsAgo,
        },
      ])

      const { results, degraded } = await hybridSearch(
        'TypeScript',
        { mode: 'keyword', limit: 10, temporalDecay: true, halfLifeDays: 180 },
        mockDb as unknown as NodePgDatabase<typeof schema>,
      )

      expect(results).toHaveLength(1)
      expect(results[0]?.similarity).toBeCloseTo(0.5, 1)
      expect(degraded).toBe(false)
    })

    it('handles chunks from videos with null publishedAt', async () => {
      mockDb._selectChain.limit.mockResolvedValue([
        {
          chunkId: 1,
          content: 'TypeScript programming',
          startTime: 0,
          endTime: 10,
          similarity: '1.0',
          videoId: 1,
          videoTitle: 'No Date Video',
          channel: 'Test Channel',
          youtubeId: 'no-date-vid',
          thumbnail: null,
          publishedAt: null,
        },
      ])

      const { results, degraded } = await hybridSearch(
        'TypeScript',
        { mode: 'keyword', limit: 10, temporalDecay: true },
        mockDb as unknown as NodePgDatabase<typeof schema>,
      )

      expect(results).toHaveLength(1)
      expect(results[0]?.similarity).toBeCloseTo(1.0, 2)
      expect(degraded).toBe(false)
    })

    it('re-sorts results after applying decay', async () => {
      const now = new Date()
      const twoYearsAgo = new Date(now.getTime() - 730 * 24 * 60 * 60 * 1000)

      mockDb._selectChain.limit.mockResolvedValue([
        {
          chunkId: 1,
          content: 'TypeScript TypeScript programming',
          startTime: 0,
          endTime: 10,
          similarity: '1.0',
          videoId: 1,
          videoTitle: 'Old Video',
          channel: 'Test Channel',
          youtubeId: 'old-vid',
          thumbnail: null,
          publishedAt: twoYearsAgo,
        },
        {
          chunkId: 2,
          content: 'TypeScript programming',
          startTime: 0,
          endTime: 10,
          similarity: '1.0',
          videoId: 2,
          videoTitle: 'New Video',
          channel: 'Test Channel',
          youtubeId: 'new-vid',
          thumbnail: null,
          publishedAt: now,
        },
      ])

      const { results: resultsNoDecay } = await hybridSearch(
        'TypeScript',
        { mode: 'keyword', limit: 10, temporalDecay: false },
        mockDb as unknown as NodePgDatabase<typeof schema>,
      )

      const { results: resultsWithDecay } = await hybridSearch(
        'TypeScript',
        { mode: 'keyword', limit: 10, temporalDecay: true },
        mockDb as unknown as NodePgDatabase<typeof schema>,
      )

      expect(resultsNoDecay[0]?.videoId).toBe(1)
      expect(resultsWithDecay[0]?.videoId).toBe(2)
    })

    it('applies decay in hybrid mode', async () => {
      const now = new Date()
      const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000)

      vi.mocked(vectorSearch).mockResolvedValue([
        {
          chunkId: 1,
          content: 'TypeScript programming',
          startTime: 0,
          endTime: 10,
          similarity: 0.9,
          videoId: 1,
          videoTitle: 'Old Video',
          channel: 'Test Channel',
          youtubeId: 'old-vid',
          thumbnail: null,
          publishedAt: oneYearAgo,
        },
        {
          chunkId: 2,
          content: 'TypeScript programming',
          startTime: 0,
          endTime: 10,
          similarity: 0.9,
          videoId: 2,
          videoTitle: 'New Video',
          channel: 'Test Channel',
          youtubeId: 'new-vid',
          thumbnail: null,
          publishedAt: now,
        },
      ])

      mockDb._selectChain.limit.mockResolvedValue([
        {
          chunkId: 1,
          content: 'TypeScript programming',
          startTime: 0,
          endTime: 10,
          similarity: '1.0',
          videoId: 1,
          videoTitle: 'Old Video',
          channel: 'Test Channel',
          youtubeId: 'old-vid',
          thumbnail: null,
          publishedAt: oneYearAgo,
        },
        {
          chunkId: 2,
          content: 'TypeScript programming',
          startTime: 0,
          endTime: 10,
          similarity: '1.0',
          videoId: 2,
          videoTitle: 'New Video',
          channel: 'Test Channel',
          youtubeId: 'new-vid',
          thumbnail: null,
          publishedAt: now,
        },
      ])

      const { results, degraded } = await hybridSearch(
        'TypeScript',
        { mode: 'hybrid', limit: 10, temporalDecay: true },
        mockDb as unknown as NodePgDatabase<typeof schema>,
      )

      expect(results).toHaveLength(2)

      const newResult = results.find(r => r.videoId === 2)
      const oldResult = results.find(r => r.videoId === 1)

      expect(newResult).toBeDefined()
      expect(oldResult).toBeDefined()
      expect(newResult!.similarity).toBeGreaterThan(oldResult!.similarity)
      expect(degraded).toBe(false)
    })

    it('applies decay in vector mode', async () => {
      const now = new Date()
      const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000)

      vi.mocked(vectorSearch).mockResolvedValue([
        {
          chunkId: 1,
          content: 'Some content here',
          startTime: 0,
          endTime: 10,
          similarity: 0.9,
          videoId: 1,
          videoTitle: 'Old Video',
          channel: 'Test Channel',
          youtubeId: 'old-vid',
          thumbnail: null,
          publishedAt: oneYearAgo,
        },
        {
          chunkId: 2,
          content: 'Different content',
          startTime: 0,
          endTime: 10,
          similarity: 0.9,
          videoId: 2,
          videoTitle: 'New Video',
          channel: 'Test Channel',
          youtubeId: 'new-vid',
          thumbnail: null,
          publishedAt: now,
        },
      ])

      const { results, degraded } = await hybridSearch(
        'query',
        { mode: 'vector', limit: 10, temporalDecay: true },
        mockDb as unknown as NodePgDatabase<typeof schema>,
      )

      const newResult = results.find(r => r.videoId === 2)
      const oldResult = results.find(r => r.videoId === 1)

      if (newResult && oldResult) {
        expect(newResult.similarity).toBeGreaterThan(oldResult.similarity)
      }
      expect(degraded).toBe(false)
    })
  })

  describe('channel filter', () => {
    it('omitted channel produces global behavior (FIRST test - opt-in guard)', async () => {
      // When channel is NOT provided, hybridSearch behaves identically to today.
      // vectorSearch should be called without a channel arg (5th param absent or undefined).
      vi.mocked(vectorSearch).mockResolvedValue([
        {
          chunkId: 1,
          content: 'Some global content',
          startTime: 0,
          endTime: 10,
          similarity: 0.85,
          videoId: 1,
          videoTitle: 'Global Video',
          channel: 'Channel A',
          youtubeId: 'vid-1',
          thumbnail: null,
          publishedAt: null,
        },
      ])
      mockDb._selectChain.limit.mockResolvedValue([])

      const { results, degraded } = await hybridSearch(
        'global query',
        { mode: 'hybrid', limit: 10 },
        mockDb as unknown as NodePgDatabase<typeof schema>,
      )

      expect(degraded).toBe(false)
      expect(Array.isArray(results)).toBe(true)

      // vectorSearch must NOT receive a channel arg (5th param)
      const vsCall = vi.mocked(vectorSearch).mock.calls[0]
      expect(vsCall).toBeDefined()
      expect(vsCall![4]).toBeUndefined()
    })

    it('channel filter applied in vector mode - forwards channel to vectorSearch', async () => {
      vi.mocked(vectorSearch).mockResolvedValue([
        {
          chunkId: 5,
          content: 'Small channel content',
          startTime: 0,
          endTime: 10,
          similarity: 0.8,
          videoId: 5,
          videoTitle: 'Small Channel Video',
          channel: 'Small Creator',
          youtubeId: 'vid-5',
          thumbnail: null,
          publishedAt: null,
        },
      ])

      const { results, degraded } = await hybridSearch(
        'specific topic',
        { mode: 'vector', limit: 10, channel: 'Small Creator' },
        mockDb as unknown as NodePgDatabase<typeof schema>,
      )

      expect(degraded).toBe(false)
      expect(results).toHaveLength(1)

      // vectorSearch MUST receive 'Small Creator' as the 5th positional arg
      const vsCall = vi.mocked(vectorSearch).mock.calls[0]
      expect(vsCall).toBeDefined()
      expect(vsCall![4]).toBe('Small Creator')
    })

    it('channel filter applied in keyword mode - where clause contains channel filter', async () => {
      mockDb._selectChain.limit.mockResolvedValue([
        {
          chunkId: 10,
          content: 'Keyword match in small channel',
          startTime: 0,
          endTime: 10,
          similarity: '1.0',
          videoId: 10,
          videoTitle: 'Small Channel Video',
          channel: 'Tiny Creator',
          youtubeId: 'vid-10',
          thumbnail: null,
          publishedAt: null,
        },
      ])

      const { results, degraded } = await hybridSearch(
        'keyword query',
        { mode: 'keyword', limit: 10, channel: 'Tiny Creator' },
        mockDb as unknown as NodePgDatabase<typeof schema>,
      )

      expect(degraded).toBe(false)
      expect(results).toHaveLength(1)
      expect(results[0]?.channel).toBe('Tiny Creator')

      // where() must have been called (channel filter ANDed in)
      expect(mockDb._selectChain.where).toHaveBeenCalled()
    })

    it('channel filter applied in hybrid mode before fusion - both legs receive channel', async () => {
      // The filter-before-fusion seam: both vectorSearch AND keywordSearch
      // must receive the channel filter before RRF fusion runs.
      vi.mocked(vectorSearch).mockResolvedValue([
        {
          chunkId: 20,
          content: 'Small channel vector result',
          startTime: 0,
          endTime: 10,
          similarity: 0.9,
          videoId: 20,
          videoTitle: 'Small Video',
          channel: 'Niche Creator',
          youtubeId: 'vid-20',
          thumbnail: null,
          publishedAt: null,
        },
      ])
      mockDb._selectChain.limit.mockResolvedValue([
        {
          chunkId: 21,
          content: 'Small channel keyword result',
          startTime: 5,
          endTime: 15,
          similarity: '1.0',
          videoId: 20,
          videoTitle: 'Small Video',
          channel: 'Niche Creator',
          youtubeId: 'vid-20',
          thumbnail: null,
          publishedAt: null,
        },
      ])

      const { results, degraded } = await hybridSearch(
        'hybrid query',
        { mode: 'hybrid', limit: 10, channel: 'Niche Creator' },
        mockDb as unknown as NodePgDatabase<typeof schema>,
      )

      expect(degraded).toBe(false)
      expect(results.length).toBeGreaterThan(0)

      // Vector leg: vectorSearch 5th param must be the channel
      const vsCall = vi.mocked(vectorSearch).mock.calls[0]
      expect(vsCall).toBeDefined()
      expect(vsCall![4]).toBe('Niche Creator')

      // Keyword leg: where() must have been called (AND'd with channel)
      expect(mockDb._selectChain.where).toHaveBeenCalled()
    })

    it('degraded fallback keeps channel scope - no silent global on embedding failure', async () => {
      // Force both embedding attempts to fail so the fallback path triggers.
      const mockGenerate = vi.mocked(generateEmbedding)
      mockGenerate
        .mockRejectedValueOnce(new Error('protobuf parsing failed'))
        .mockRejectedValueOnce(new Error('protobuf parsing failed'))

      mockDb._selectChain.limit.mockResolvedValue([
        {
          chunkId: 30,
          content: 'Fallback keyword result for small channel',
          startTime: 0,
          endTime: 10,
          similarity: '1.0',
          videoId: 30,
          videoTitle: 'Fallback Video',
          channel: 'Scoped Creator',
          youtubeId: 'vid-30',
          thumbnail: null,
          publishedAt: null,
        },
      ])

      const { results, degraded } = await hybridSearch(
        'fallback query',
        { mode: 'hybrid', limit: 10, channel: 'Scoped Creator' },
        mockDb as unknown as NodePgDatabase<typeof schema>,
      )

      // Must fall back to keyword (degraded) - not silently go global
      expect(degraded).toBe(true)
      expect(results).toHaveLength(1)
      expect(results[0]?.channel).toBe('Scoped Creator')

      // vectorSearch must NOT have been called (embedding failed before vector leg)
      expect(vectorSearch).not.toHaveBeenCalled()

      // keyword where() must have been called (channel filter preserved in fallback)
      expect(mockDb._selectChain.where).toHaveBeenCalled()
    })
  })

  describe('embedding resilience', () => {
    it('retries embedding once and succeeds on second attempt', async () => {
      const mockGenerate = vi.mocked(generateEmbedding)

      // First call fails, second succeeds
      mockGenerate
        .mockRejectedValueOnce(new Error('Failed to load model because protobuf parsing failed'))
        .mockResolvedValueOnce(new Float32Array(384).fill(0.5))

      vi.mocked(vectorSearch).mockResolvedValue([])
      mockDb._selectChain.limit.mockResolvedValue([])

      const { results, degraded } = await hybridSearch(
        'test query',
        { mode: 'hybrid', limit: 10 },
        mockDb as unknown as NodePgDatabase<typeof schema>,
      )

      expect(mockGenerate).toHaveBeenCalledTimes(2)
      expect(degraded).toBe(false)
      expect(Array.isArray(results)).toBe(true)
    })

    it('falls back to keyword-only when both embedding attempts fail (hybrid mode)', async () => {
      const mockGenerate = vi.mocked(generateEmbedding)

      mockGenerate
        .mockRejectedValueOnce(new Error('protobuf parsing failed'))
        .mockRejectedValueOnce(new Error('protobuf parsing failed'))

      mockDb._selectChain.limit.mockResolvedValue([
        {
          chunkId: 1,
          content: 'Keyword match result',
          startTime: 0,
          endTime: 10,
          similarity: '1.0',
          videoId: 1,
          videoTitle: 'Test',
          channel: 'Test',
          youtubeId: 'test',
          thumbnail: null,
          publishedAt: null,
        },
      ])

      const { results, degraded } = await hybridSearch(
        'Keyword',
        { mode: 'hybrid', limit: 10 },
        mockDb as unknown as NodePgDatabase<typeof schema>,
      )

      expect(degraded).toBe(true)
      expect(results.length).toBeGreaterThan(0)
      expect(results[0]?.content).toBe('Keyword match result')
      // vectorSearch should NOT have been called since embedding failed
      expect(vectorSearch).not.toHaveBeenCalled()
    })

    it('falls back to keyword-only when both embedding attempts fail (vector mode)', async () => {
      const mockGenerate = vi.mocked(generateEmbedding)

      mockGenerate
        .mockRejectedValueOnce(new Error('protobuf parsing failed'))
        .mockRejectedValueOnce(new Error('protobuf parsing failed'))

      mockDb._selectChain.limit.mockResolvedValue([
        {
          chunkId: 1,
          content: 'Keyword fallback',
          startTime: 0,
          endTime: 10,
          similarity: '1.0',
          videoId: 1,
          videoTitle: 'Test',
          channel: 'Test',
          youtubeId: 'test',
          thumbnail: null,
          publishedAt: null,
        },
      ])

      const { results, degraded } = await hybridSearch(
        'Keyword',
        { mode: 'vector', limit: 10 },
        mockDb as unknown as NodePgDatabase<typeof schema>,
      )

      expect(degraded).toBe(true)
      expect(results.length).toBeGreaterThan(0)
    })

    it('keyword mode is not affected by embedding failures', async () => {
      mockDb._selectChain.limit.mockResolvedValue([])

      const { degraded } = await hybridSearch(
        'test',
        { mode: 'keyword', limit: 10 },
        mockDb as unknown as NodePgDatabase<typeof schema>,
      )

      expect(degraded).toBe(false)
    })
  })
})
