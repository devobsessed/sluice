import { describe, it, expect, beforeEach, vi } from 'vitest'
import { searchVideos, getVideoStats, getDistinctChannels } from '../search'

const createMockDb = () => {
  const mockSelectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
  }
  return {
    select: vi.fn(() => mockSelectChain),
    _selectChain: mockSelectChain,
  }
}

type MockDb = ReturnType<typeof createMockDb>

describe('searchVideos', () => {
  let db: MockDb

  beforeEach(() => {
    vi.clearAllMocks()
    db = createMockDb()
  })

  it('returns empty array when no videos exist', async () => {
    db._selectChain.limit.mockResolvedValue([])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await searchVideos('test query', {}, db as any)
    expect(result.items).toEqual([])
    expect(result.hasMore).toBe(false)
    expect(result.nextCursor).toBeNull()
  })

  it('returns all videos when query is empty', async () => {
    const now = new Date()
    const earlier = new Date(now.getTime() - 60000)

    db._selectChain.limit.mockResolvedValue([
      {
        id: 2,
        youtubeId: 'ds-vid2',
        sourceType: 'youtube',
        title: 'Second Video',
        channel: 'Channel B',
        thumbnail: null,
        duration: 900,
        description: null,
        createdAt: now,
        updatedAt: now,
        publishedAt: null,
      },
      {
        id: 1,
        youtubeId: 'ds-vid1',
        sourceType: 'youtube',
        title: 'First Video',
        channel: 'Channel A',
        thumbnail: null,
        duration: 600,
        description: null,
        createdAt: earlier,
        updatedAt: earlier,
        publishedAt: null,
      },
    ])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await searchVideos('', {}, db as any)
    expect(result.items).toHaveLength(2)
    expect(result.items[0]?.title).toBe('Second Video')
    expect(result.items[1]?.title).toBe('First Video')
  })

  it('finds videos by title match using ILIKE', async () => {
    db._selectChain.limit.mockResolvedValue([
      {
        id: 1,
        youtubeId: 'ds-vid1',
        sourceType: 'youtube',
        title: 'TypeScript Deep Dive',
        channel: 'Dev Channel',
        thumbnail: null,
        duration: 600,
        description: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        publishedAt: null,
      },
    ])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await searchVideos('typescript', {}, db as any)
    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.title).toBe('TypeScript Deep Dive')
    // Verify that where was called for non-empty query
    expect(db._selectChain.where).toHaveBeenCalled()
  })

  it('finds videos by channel name', async () => {
    db._selectChain.limit.mockResolvedValue([
      {
        id: 1,
        youtubeId: 'ds-vid1',
        sourceType: 'youtube',
        title: 'Video One',
        channel: 'Fireship',
        thumbnail: null,
        duration: 600,
        description: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        publishedAt: null,
      },
    ])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await searchVideos('fireship', {}, db as any)
    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.channel).toBe('Fireship')
  })

  it('is case insensitive', async () => {
    const video = {
      id: 1,
      youtubeId: 'ds-vid1',
      sourceType: 'youtube',
      title: 'JavaScript Performance',
      channel: 'Dev Channel',
      thumbnail: null,
      duration: 600,
      description: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      publishedAt: null,
    }

    db._selectChain.limit.mockResolvedValue([video])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const upperResult = await searchVideos('JAVASCRIPT', {}, db as any)
    expect(upperResult.items).toHaveLength(1)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mixedResult = await searchVideos('JaVaScRiPt', {}, db as any)
    expect(mixedResult.items).toHaveLength(1)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lowerResult = await searchVideos('javascript', {}, db as any)
    expect(lowerResult.items).toHaveLength(1)

    // searchVideos should call where for each non-empty query
    expect(db._selectChain.where).toHaveBeenCalledTimes(3)
  })

  it('excludes transcript from returned results', async () => {
    db._selectChain.limit.mockResolvedValue([
      {
        id: 1,
        youtubeId: 'ds-vid1',
        sourceType: 'youtube',
        title: 'Video With Transcript',
        channel: 'Channel A',
        thumbnail: null,
        duration: 600,
        description: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        publishedAt: null,
      },
    ])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await searchVideos('', {}, db as any)
    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.title).toBe('Video With Transcript')
    // Verify transcript is NOT in the returned object
    expect('transcript' in result.items[0]!).toBe(false)
  })
})

describe('searchVideos pagination', () => {
  let db: MockDb

  beforeEach(() => {
    vi.clearAllMocks()
    db = createMockDb()
  })

  it('returns hasMore: true when more results than limit', async () => {
    // Return 4 items (limit + 1) to signal hasMore
    const mockVideos = Array.from({ length: 4 }, (_, i) => ({
      id: 4 - i,
      youtubeId: `vid-${4 - i}`,
      sourceType: 'youtube',
      title: `Video ${4 - i}`,
      channel: 'Channel',
      thumbnail: null,
      duration: 600,
      description: null,
      createdAt: new Date(2026, 0, 4 - i),
      updatedAt: new Date(2026, 0, 4 - i),
      publishedAt: null,
    }))
    db._selectChain.limit.mockResolvedValue(mockVideos)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await searchVideos('', { limit: 3 }, db as any)
    expect(result.items).toHaveLength(3)
    expect(result.hasMore).toBe(true)
    expect(result.nextCursor).toBeTruthy()
  })

  it('returns hasMore: false when fewer results than limit', async () => {
    db._selectChain.limit.mockResolvedValue([
      {
        id: 1,
        youtubeId: 'vid-1',
        sourceType: 'youtube',
        title: 'Only Video',
        channel: 'Channel',
        thumbnail: null,
        duration: 600,
        description: null,
        createdAt: new Date(2026, 0, 1),
        updatedAt: new Date(2026, 0, 1),
        publishedAt: null,
      },
    ])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await searchVideos('', { limit: 24 }, db as any)
    expect(result.items).toHaveLength(1)
    expect(result.hasMore).toBe(false)
    expect(result.nextCursor).toBeNull()
  })

  it('nextCursor encodes the last item createdAt and id', async () => {
    const lastDate = new Date(2026, 0, 3)
    // Return limit + 1 items so hasMore is true
    db._selectChain.limit.mockResolvedValue([
      {
        id: 3,
        youtubeId: 'vid-3',
        sourceType: 'youtube',
        title: 'Video 3',
        channel: 'Channel',
        thumbnail: null,
        duration: 600,
        description: null,
        createdAt: new Date(2026, 0, 4),
        updatedAt: new Date(2026, 0, 4),
        publishedAt: null,
      },
      {
        id: 2,
        youtubeId: 'vid-2',
        sourceType: 'youtube',
        title: 'Video 2',
        channel: 'Channel',
        thumbnail: null,
        duration: 600,
        description: null,
        createdAt: lastDate,
        updatedAt: lastDate,
        publishedAt: null,
      },
      {
        // This is the extra item beyond limit=2 that triggers hasMore
        id: 1,
        youtubeId: 'vid-1',
        sourceType: 'youtube',
        title: 'Video 1',
        channel: 'Channel',
        thumbnail: null,
        duration: 600,
        description: null,
        createdAt: new Date(2026, 0, 2),
        updatedAt: new Date(2026, 0, 2),
        publishedAt: null,
      },
    ])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await searchVideos('', { limit: 2 }, db as any)
    expect(result.hasMore).toBe(true)
    expect(result.nextCursor).toBeTruthy()

    // Decode the cursor and verify it points to the last returned item (id: 2)
    const decoded = JSON.parse(Buffer.from(result.nextCursor!, 'base64url').toString('utf8'))
    expect(decoded.id).toBe(2)
    expect(decoded.createdAt).toBe(lastDate.toISOString())
  })

  it('passes cursor condition via where when cursor option is provided', async () => {
    // Encode a cursor for a known position
    const cursorPayload = { createdAt: new Date(2026, 0, 5).toISOString(), id: 10 }
    const cursor = Buffer.from(JSON.stringify(cursorPayload)).toString('base64url')

    db._selectChain.limit.mockResolvedValue([])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await searchVideos('', { cursor }, db as any)

    // where() should be called because cursor adds a condition
    expect(db._selectChain.where).toHaveBeenCalled()
  })

  it('passes channel filter condition via where when channel option is provided', async () => {
    db._selectChain.limit.mockResolvedValue([])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await searchVideos('', { channel: 'Fireship' }, db as any)

    expect(db._selectChain.where).toHaveBeenCalled()
  })

  it('skips where clause when no conditions apply', async () => {
    db._selectChain.limit.mockResolvedValue([])

    // Empty query, no cursor, no channel, no focusAreaId
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await searchVideos('', {}, db as any)

    expect(db._selectChain.where).not.toHaveBeenCalled()
  })

  it('uses default page size of 24 when limit is not provided', async () => {
    // Return 25 items (default limit + 1) to verify default is 24
    const mockVideos = Array.from({ length: 25 }, (_, i) => ({
      id: 25 - i,
      youtubeId: `vid-${25 - i}`,
      sourceType: 'youtube',
      title: `Video ${25 - i}`,
      channel: 'Channel',
      thumbnail: null,
      duration: 600,
      description: null,
      createdAt: new Date(2026, 0, 25 - i),
      updatedAt: new Date(2026, 0, 25 - i),
      publishedAt: null,
    }))
    db._selectChain.limit.mockResolvedValue(mockVideos)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await searchVideos('', {}, db as any)
    // Default limit is 24, so 25 items means hasMore: true
    expect(result.items).toHaveLength(24)
    expect(result.hasMore).toBe(true)
  })

  it('returns nextCursor null when no items returned', async () => {
    db._selectChain.limit.mockResolvedValue([])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await searchVideos('', {}, db as any)
    expect(result.nextCursor).toBeNull()
    expect(result.hasMore).toBe(false)
  })
})

describe('getVideoStats', () => {
  let db: MockDb

  beforeEach(() => {
    vi.clearAllMocks()
    db = createMockDb()
  })

  it('returns zeros when no videos exist', async () => {
    // getVideoStats uses select().from() which resolves via the chain
    // The chain ends at from() since there's no where/orderBy/groupBy
    db._selectChain.from.mockResolvedValue([
      { count: 0, totalDuration: 0, channels: 0 },
    ])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stats = await getVideoStats(db as any)
    expect(stats).toEqual({
      count: 0,
      totalHours: 0,
      channels: 0,
    })
  })

  it('counts videos correctly', async () => {
    db._selectChain.from.mockResolvedValue([
      { count: 3, totalDuration: 2700, channels: 2 },
    ])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stats = await getVideoStats(db as any)
    expect(stats.count).toBe(3)
  })

  it('calculates total hours correctly', async () => {
    db._selectChain.from.mockResolvedValue([
      { count: 2, totalDuration: 5400, channels: 1 },
    ])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stats = await getVideoStats(db as any)
    expect(stats.totalHours).toBe(1.5)
  })

  it('counts unique channels', async () => {
    db._selectChain.from.mockResolvedValue([
      { count: 3, totalDuration: 2700, channels: 2 },
    ])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stats = await getVideoStats(db as any)
    expect(stats.channels).toBe(2)
  })
})

describe('getDistinctChannels', () => {
  let db: MockDb

  beforeEach(() => {
    vi.clearAllMocks()
    db = createMockDb()
  })

  it('returns empty array when no videos exist', async () => {
    db._selectChain.orderBy.mockResolvedValue([])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const creators = await getDistinctChannels(db as any)
    expect(creators).toEqual([])
  })

  it('returns single channel with correct video count', async () => {
    db._selectChain.orderBy.mockResolvedValue([
      { channel: 'Solo Creator', videoCount: 1 },
    ])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const creators = await getDistinctChannels(db as any)
    expect(creators).toEqual([
      { channel: 'Solo Creator', videoCount: 1 },
    ])
  })

  it('returns multiple channels with correct video counts', async () => {
    db._selectChain.orderBy.mockResolvedValue([
      { channel: 'Channel A', videoCount: 2 },
      { channel: 'Channel B', videoCount: 1 },
    ])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const creators = await getDistinctChannels(db as any)
    expect(creators).toHaveLength(2)
    expect(creators).toContainEqual({ channel: 'Channel A', videoCount: 2 })
    expect(creators).toContainEqual({ channel: 'Channel B', videoCount: 1 })
  })

  it('sorts channels by video count descending', async () => {
    db._selectChain.orderBy.mockResolvedValue([
      { channel: 'Big Channel', videoCount: 3 },
      { channel: 'Medium Channel', videoCount: 2 },
      { channel: 'Small Channel', videoCount: 1 },
    ])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const creators = await getDistinctChannels(db as any)
    expect(creators).toEqual([
      { channel: 'Big Channel', videoCount: 3 },
      { channel: 'Medium Channel', videoCount: 2 },
      { channel: 'Small Channel', videoCount: 1 },
    ])
  })

  it('handles channels with identical video counts', async () => {
    db._selectChain.orderBy.mockResolvedValue([
      { channel: 'Channel A', videoCount: 1 },
      { channel: 'Channel B', videoCount: 1 },
    ])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const creators = await getDistinctChannels(db as any)
    expect(creators).toHaveLength(2)
    expect(creators.every((c: { videoCount: number }) => c.videoCount === 1)).toBe(true)
    const channels = creators.map((c: { channel: string }) => c.channel)
    expect(channels).toContain('Channel A')
    expect(channels).toContain('Channel B')
  })

  it('filters out null channels', async () => {
    db._selectChain.orderBy.mockResolvedValue([
      { channel: 'Valid Channel', videoCount: 2 },
      { channel: null, videoCount: 1 },
    ])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const creators = await getDistinctChannels(db as any)
    expect(creators).toHaveLength(1)
    expect(creators[0]?.channel).toBe('Valid Channel')
  })
})
