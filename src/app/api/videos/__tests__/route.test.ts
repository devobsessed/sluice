import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/auth-guards', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth-guards')>()
  return {
    ...actual,
    requireSession: vi.fn().mockResolvedValue(null),
  }
})

// Mock next/server
const mockAfter = vi.fn()
vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server')
  return { ...actual, after: mockAfter }
})

// Mock the metadata fetcher
const mockFetchVideoPageMetadata = vi.fn()
vi.mock('@/lib/youtube/metadata', () => ({
  fetchVideoPageMetadata: mockFetchVideoPageMetadata,
}))

// Mock the embedding pipeline
vi.mock('@/lib/embeddings/pipeline', () => ({
  generateEmbedding: vi.fn().mockResolvedValue(new Float32Array(384).fill(0.5)),
}))

// Mock embeddings service
vi.mock('@/lib/embeddings/service', () => ({
  embedChunks: vi.fn().mockResolvedValue({
    chunks: [],
    totalChunks: 0,
    successCount: 0,
    errorCount: 0,
    durationMs: 0,
    relationshipsCreated: 0,
  }),
}))

// Mock transcript parser
vi.mock('@/lib/transcript/parse', () => ({
  parseTranscript: vi.fn().mockReturnValue([]),
}))

// Mock chunker
vi.mock('@/lib/embeddings/chunker', () => ({
  chunkTranscript: vi.fn().mockReturnValue([]),
}))

// Mock workflow/api
vi.mock('workflow/api', () => ({
  start: vi.fn(),
}))

// Mock embeddings workflow
vi.mock('@/workflows/embeddings', () => ({
  embeddingsWorkflow: vi.fn(),
}))

// Configurable mock state
let nextVideoId = 1
let selectDuplicateResult: unknown[] = []

// Mock searchVideos, getVideoStats, getDistinctChannels
const mockSearchVideos = vi.fn()
const mockGetVideoStats = vi.fn()
const mockGetDistinctChannels = vi.fn()

// Mock db.select chain and db.insert chain
const mockSelectFrom = vi.fn()
const mockInsertValues = vi.fn()

vi.mock('@/lib/db', async () => {
  const actual = await vi.importActual<typeof import('@/lib/db')>('@/lib/db')
  return {
    ...actual,
    db: {
      select: vi.fn().mockImplementation(() => ({
        from: (...args: unknown[]) => mockSelectFrom(...args),
      })),
      insert: vi.fn().mockImplementation(() => ({
        values: (...args: unknown[]) => mockInsertValues(...args),
      })),
      delete: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    },
    searchVideos: mockSearchVideos,
    getVideoStats: mockGetVideoStats,
    getDistinctChannels: mockGetDistinctChannels,
  }
})

// Import after mocking
const { GET, POST } = await import('../route')

function setupDefaultInsertMock() {
  mockInsertValues.mockImplementation((vals: Record<string, unknown> | Record<string, unknown>[]) => {
    const rows = Array.isArray(vals) ? vals : [vals]
    const created = rows.map((v: Record<string, unknown>) => {
      const id = nextVideoId++
      return {
        id,
        sourceType: v.sourceType ?? 'youtube',
        youtubeId: v.youtubeId ?? null,
        title: v.title ?? null,
        channel: v.channel ?? null,
        thumbnail: v.thumbnail ?? null,
        transcript: v.transcript ?? null,
        publishedAt: v.publishedAt ?? null,
        duration: v.duration ?? null,
        description: v.description ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
    })
    return {
      returning: vi.fn().mockResolvedValue(created),
    }
  })
}

function setupDefaultSelectMock() {
  // Default: duplicate check returns empty (no duplicate)
  mockSelectFrom.mockReturnValue({
    where: vi.fn().mockReturnValue({
      limit: vi.fn().mockResolvedValue(selectDuplicateResult),
    }),
    innerJoin: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([]),
    }),
  })
}

describe('POST /api/videos', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    nextVideoId = 1
    selectDuplicateResult = []

    mockSearchVideos.mockResolvedValue([])
    mockGetVideoStats.mockResolvedValue({ count: 0, channels: 0 })
    mockGetDistinctChannels.mockResolvedValue([])
    mockFetchVideoPageMetadata.mockReset()

    setupDefaultSelectMock()
    setupDefaultInsertMock()
  })

  it('creates video with publishedAt field', async () => {
    const publishedDate = '2024-01-15T10:30:00.000Z'
    const request = new Request('http://localhost:3000/api/videos', {
      method: 'POST',
      body: JSON.stringify({
        youtubeId: 'test-video-123',
        title: 'Test Video',
        channel: 'Test Channel',
        thumbnail: 'https://example.com/thumb.jpg',
        transcript: 'This is a test transcript with enough characters to pass validation',
        publishedAt: publishedDate,
      }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(201)
    expect(data.video).toBeDefined()
    expect(data.video.publishedAt).toBeDefined()
    expect(new Date(data.video.publishedAt).toISOString()).toBe(publishedDate)
  })

  it('creates video without publishedAt field (null)', async () => {
    const request = new Request('http://localhost:3000/api/videos', {
      method: 'POST',
      body: JSON.stringify({
        youtubeId: 'test-video-456',
        title: 'Test Video Without Date',
        channel: 'Test Channel',
        thumbnail: 'https://example.com/thumb.jpg',
        transcript: 'This is a test transcript with enough characters to pass validation',
      }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(201)
    expect(data.video).toBeDefined()
    expect(data.video.publishedAt).toBeNull()
  })

  it('handles invalid publishedAt format gracefully', async () => {
    const request = new Request('http://localhost:3000/api/videos', {
      method: 'POST',
      body: JSON.stringify({
        youtubeId: 'test-video-invalid',
        title: 'Test Video',
        channel: 'Test Channel',
        transcript: 'This is a test transcript with enough characters to pass validation',
        publishedAt: 'not-a-valid-date',
      }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBeDefined()
  })

  it('creates transcript-type video without youtubeId', async () => {
    const request = new Request('http://localhost:3000/api/videos', {
      method: 'POST',
      body: JSON.stringify({
        sourceType: 'transcript',
        title: 'Manual Transcript Entry',
        channel: 'Test Channel',
        transcript: 'This is a manually entered transcript with enough characters to pass validation rules',
      }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(201)
    expect(data.video).toBeDefined()
    expect(data.video.sourceType).toBe('transcript')
    expect(data.video.youtubeId).toBeNull()
    expect(data.video.title).toBe('Manual Transcript Entry')
  })

  it('returns 400 when youtube-type video is missing youtubeId', async () => {
    const request = new Request('http://localhost:3000/api/videos', {
      method: 'POST',
      body: JSON.stringify({
        sourceType: 'youtube',
        title: 'YouTube Video Without ID',
        channel: 'Test Channel',
        transcript: 'This should fail because youtubeId is required for youtube sourceType',
      }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBeDefined()
    expect(data.error).toContain('YouTube ID is required')
  })

  it('returns 400 when transcript-type video is missing title', async () => {
    const request = new Request('http://localhost:3000/api/videos', {
      method: 'POST',
      body: JSON.stringify({
        sourceType: 'transcript',
        title: '',
        channel: 'Test Channel',
        transcript: 'This should fail because title is required for all video types',
      }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBeDefined()
    expect(data.error).toContain('Title is required')
  })

  it('defaults to youtube sourceType when not provided', async () => {
    const request = new Request('http://localhost:3000/api/videos', {
      method: 'POST',
      body: JSON.stringify({
        youtubeId: 'test-default-type',
        title: 'Default Type Video',
        channel: 'Test Channel',
        transcript: 'This should default to youtube sourceType for backward compatibility',
      }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(201)
    expect(data.video).toBeDefined()
    expect(data.video.sourceType).toBe('youtube')
    expect(data.video.youtubeId).toBe('test-default-type')
  })

  it('still checks for duplicate youtubeId on youtube-type videos', async () => {
    // Simulate existing video found
    selectDuplicateResult = [{ id: 1, youtubeId: 'duplicate-test-123' }]
    setupDefaultSelectMock()

    const request = new Request('http://localhost:3000/api/videos', {
      method: 'POST',
      body: JSON.stringify({
        youtubeId: 'duplicate-test-123',
        title: 'Duplicate Video',
        channel: 'Test Channel',
        transcript: 'This is a duplicate attempt with enough characters to pass validation rules',
      }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(409)
    expect(data.error).toContain('already been added')
  })

  it('allows transcript-type video without channel (null)', async () => {
    const request = new Request('http://localhost:3000/api/videos', {
      method: 'POST',
      body: JSON.stringify({
        sourceType: 'transcript',
        title: 'Transcript Without Channel',
        transcript: 'This is a transcript entry without a channel specified, which should be allowed',
      }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(201)
    expect(data.video).toBeDefined()
    expect(data.video.sourceType).toBe('transcript')
    expect(data.video.channel).toBeNull()
    expect(data.video.title).toBe('Transcript Without Channel')
  })

  it('returns 400 when youtube-type video is missing channel', async () => {
    const request = new Request('http://localhost:3000/api/videos', {
      method: 'POST',
      body: JSON.stringify({
        sourceType: 'youtube',
        youtubeId: 'test-video-no-channel',
        title: 'YouTube Video Without Channel',
        transcript: 'This should fail because channel is required for youtube sourceType',
      }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBeDefined()
    expect(data.error).toContain('Channel is required')
  })

  it('triggers auto-embed when video is created with transcript', async () => {
    mockAfter.mockClear()

    const request = new Request('http://localhost:3000/api/videos', {
      method: 'POST',
      body: JSON.stringify({
        sourceType: 'transcript',
        title: 'Auto-embed Test Video',
        transcript: 'This is a test transcript that should trigger automatic embedding generation',
      }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(201)
    expect(data.video).toBeDefined()

    expect(mockAfter).toHaveBeenCalledTimes(1)
    expect(mockAfter).toHaveBeenCalledWith(expect.any(Function))
  })

  it('does not trigger auto-embed when transcript validation fails', async () => {
    mockAfter.mockClear()

    const request = new Request('http://localhost:3000/api/videos', {
      method: 'POST',
      body: JSON.stringify({
        sourceType: 'transcript',
        title: 'No Embed Test',
        transcript: 'Short',
      }),
    })

    const response = await POST(request)

    expect(response.status).toBe(400)
    expect(mockAfter).not.toHaveBeenCalled()
  })

  it('creates video with duration and description fields', async () => {
    const request = new Request('http://localhost:3000/api/videos', {
      method: 'POST',
      body: JSON.stringify({
        youtubeId: 'test-duration-desc',
        title: 'Video with Metadata',
        channel: 'Test Channel',
        transcript: 'This is a test transcript with enough characters to pass validation',
        duration: 300,
        description: 'This is a test description from the video',
      }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(201)
    expect(data.video).toBeDefined()
    expect(data.video.duration).toBe(300)
    expect(data.video.description).toBe('This is a test description from the video')
  })

  it('auto-fetches metadata when youtubeId present and metadata fields missing', async () => {
    mockFetchVideoPageMetadata.mockResolvedValueOnce({
      publishedAt: '2024-06-09T10:00:00Z',
      description: 'Fetched description from YouTube',
      duration: 600,
    })

    const request = new Request('http://localhost:3000/api/videos', {
      method: 'POST',
      body: JSON.stringify({
        youtubeId: 'test-auto-fetch',
        title: 'Video Auto Fetch',
        channel: 'Test Channel',
        transcript: 'This is a test transcript with enough characters to pass validation',
      }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(201)
    expect(mockFetchVideoPageMetadata).toHaveBeenCalledWith('test-auto-fetch')
    expect(data.video.publishedAt).toBeDefined()
    expect(new Date(data.video.publishedAt).toISOString()).toBe('2024-06-09T10:00:00.000Z')
    expect(data.video.description).toBe('Fetched description from YouTube')
    expect(data.video.duration).toBe(600)
  })

  it('caller-provided values take priority over fetched values', async () => {
    const request = new Request('http://localhost:3000/api/videos', {
      method: 'POST',
      body: JSON.stringify({
        youtubeId: 'test-priority',
        title: 'Priority Test',
        channel: 'Test Channel',
        transcript: 'This is a test transcript with enough characters to pass validation',
        publishedAt: '2024-12-25T12:00:00.000Z',
        description: 'User provided description',
        duration: 500,
      }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(201)
    expect(mockFetchVideoPageMetadata).not.toHaveBeenCalled()
    expect(new Date(data.video.publishedAt).toISOString()).toBe('2024-12-25T12:00:00.000Z')
    expect(data.video.description).toBe('User provided description')
    expect(data.video.duration).toBe(500)
  })

  it('gracefully handles metadata fetch failure - save still succeeds', async () => {
    mockFetchVideoPageMetadata.mockReset()
    mockFetchVideoPageMetadata.mockRejectedValueOnce(new Error('YouTube fetch failed'))

    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const request = new Request('http://localhost:3000/api/videos', {
      method: 'POST',
      body: JSON.stringify({
        youtubeId: 'test-fetch-fail',
        title: 'Fetch Failure Test',
        channel: 'Test Channel',
        transcript: 'This is a test transcript with enough characters to pass validation',
      }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(201)
    expect(data.video).toBeDefined()
    expect(data.video.youtubeId).toBe('test-fetch-fail')
    expect(data.video.publishedAt).toBeNull()
    expect(data.video.description).toBeNull()
    expect(data.video.duration).toBeNull()
    expect(consoleWarnSpy).toHaveBeenCalled()

    consoleWarnSpy.mockRestore()
  })

  it('does not fetch metadata when all fields already provided', async () => {
    mockFetchVideoPageMetadata.mockClear()

    const request = new Request('http://localhost:3000/api/videos', {
      method: 'POST',
      body: JSON.stringify({
        youtubeId: 'test-no-fetch',
        title: 'No Fetch Needed',
        channel: 'Test Channel',
        transcript: 'This is a test transcript with enough characters to pass validation',
        publishedAt: '2024-06-15T08:30:00.000Z',
        description: 'Complete description',
        duration: 450,
      }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(201)
    expect(mockFetchVideoPageMetadata).not.toHaveBeenCalled()
    expect(data.video.publishedAt).toBeDefined()
    expect(data.video.description).toBe('Complete description')
    expect(data.video.duration).toBe(450)
  })

  it('includes milestones in POST response', async () => {
    mockGetVideoStats.mockResolvedValue({ count: 2, channels: 2 })
    mockGetDistinctChannels.mockResolvedValue([
      { channel: 'Test Channel', videoCount: 1 },
      { channel: 'Existing Channel', videoCount: 1 },
    ])

    const request = new Request('http://localhost:3000/api/videos', {
      method: 'POST',
      body: JSON.stringify({
        youtubeId: 'test-milestones',
        title: 'Milestones Test Video',
        channel: 'Test Channel',
        transcript: 'This is a test transcript with enough characters to pass validation',
      }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(201)
    expect(data.video).toBeDefined()
    expect(data.milestones).toBeDefined()
    expect(data.milestones.totalVideos).toBe(2)
    expect(data.milestones.channelVideoCount).toBe(1)
    expect(data.milestones.isNewChannel).toBe(true)
  })

  it('marks isNewChannel as false when adding second video from same channel', async () => {
    mockGetVideoStats.mockResolvedValue({ count: 2, channels: 1 })
    mockGetDistinctChannels.mockResolvedValue([
      { channel: 'Same Channel', videoCount: 2 },
    ])

    const request = new Request('http://localhost:3000/api/videos', {
      method: 'POST',
      body: JSON.stringify({
        youtubeId: 'second-video-same-channel',
        title: 'Second Video',
        channel: 'Same Channel',
        transcript: 'This is the second video from the same channel with enough characters',
      }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(201)
    expect(data.milestones).toBeDefined()
    expect(data.milestones.totalVideos).toBe(2)
    expect(data.milestones.channelVideoCount).toBe(2)
    expect(data.milestones.isNewChannel).toBe(false)
  })

  it('handles transcript-type videos with null channel in milestones', async () => {
    mockGetVideoStats.mockResolvedValue({ count: 1, channels: 0 })
    mockGetDistinctChannels.mockResolvedValue([])

    const request = new Request('http://localhost:3000/api/videos', {
      method: 'POST',
      body: JSON.stringify({
        sourceType: 'transcript',
        title: 'Transcript Without Channel',
        transcript: 'This is a transcript entry without channel for milestone testing',
      }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(201)
    expect(data.video.channel).toBeNull()
    expect(data.milestones).toBeDefined()
    expect(data.milestones.totalVideos).toBe(1)
    expect(data.milestones.channelVideoCount).toBe(0)
    expect(data.milestones.isNewChannel).toBe(false)
  })

  it('returns 201 even when Vercel workflow dispatch fails', async () => {
    // Simulate Vercel environment
    const originalVercel = process.env.VERCEL
    process.env.VERCEL = '1'

    // Make start() reject
    const { start: mockStart } = await import('workflow/api')
    vi.mocked(mockStart).mockRejectedValueOnce(new Error('Workflow dispatch failed'))

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const request = new Request('http://localhost:3000/api/videos', {
      method: 'POST',
      body: JSON.stringify({
        youtubeId: 'test-workflow-fail',
        title: 'Workflow Fail Test',
        channel: 'Test Channel',
        transcript: 'This is a test transcript with enough characters to pass validation rules here',
      }),
    })

    const response = await POST(request)
    const data = await response.json()

    // Video should still be created successfully
    expect(response.status).toBe(201)
    expect(data.video).toBeDefined()
    expect(data.video.youtubeId).toBe('test-workflow-fail')

    // Error should be logged
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[workflow-dispatch]'),
      expect.any(Error),
    )

    consoleErrorSpy.mockRestore()
    process.env.VERCEL = originalVercel
  })
})

describe('GET /api/videos', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSearchVideos.mockResolvedValue([])
    mockGetVideoStats.mockResolvedValue({ count: 0, channels: 0 })
    mockGetDistinctChannels.mockResolvedValue([])

    // Default: select returns empty for both focusArea assignments and insights
    mockSelectFrom.mockReturnValue({
      where: vi.fn().mockResolvedValue([]),
      innerJoin: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    })
  })

  it('returns empty list when no videos exist', async () => {
    const request = new Request('http://localhost:3000/api/videos')
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.videos).toEqual([])
  })

  it('returns videos with all fields including publishedAt', async () => {
    const publishedDate = new Date('2024-03-10T08:00:00Z')
    mockSearchVideos.mockResolvedValue([
      {
        id: 1,
        youtubeId: 'test-full-fields',
        title: 'Full Fields Video',
        channel: 'Test Channel',
        thumbnail: 'https://example.com/thumb.jpg',
        duration: null,
        description: null,
        publishedAt: publishedDate,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ])

    const request = new Request('http://localhost:3000/api/videos')
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.videos).toHaveLength(1)
    expect(data.videos[0]).toMatchObject({
      youtubeId: 'test-full-fields',
      title: 'Full Fields Video',
      channel: 'Test Channel',
      thumbnail: 'https://example.com/thumb.jpg',
    })
    expect(data.videos[0].publishedAt).toBeDefined()
  })

  it('returns 400 for invalid focusAreaId', async () => {
    const request = new Request('http://localhost:3000/api/videos?focusAreaId=invalid')
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBeDefined()
  })

  it('filters videos by channel when channel param is provided', async () => {
    mockSearchVideos.mockResolvedValue([
      { id: 1, youtubeId: 'fireship-1', title: 'React in 100 Seconds', channel: 'Fireship' },
      { id: 2, youtubeId: 'fireship-2', title: 'TypeScript in 100 Seconds', channel: 'Fireship' },
      { id: 3, youtubeId: 'theo-1', title: 'Why I use TypeScript', channel: 'Theo' },
    ])

    const request = new Request('http://localhost:3000/api/videos?channel=Fireship')
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.videos).toHaveLength(2)
    expect(data.videos.every((v: { channel: string }) => v.channel === 'Fireship')).toBe(true)
  })

  it('returns all videos when channel param is not provided', async () => {
    mockSearchVideos.mockResolvedValue([
      { id: 1, youtubeId: 'channel-a-1', title: 'Video A1', channel: 'Channel A' },
      { id: 2, youtubeId: 'channel-b-1', title: 'Video B1', channel: 'Channel B' },
    ])

    const request = new Request('http://localhost:3000/api/videos')
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.videos).toHaveLength(2)
  })

  it('returns empty list when channel param matches no videos', async () => {
    mockSearchVideos.mockResolvedValue([
      { id: 1, youtubeId: 'some-video', title: 'Some Video', channel: 'Known Channel' },
    ])

    const request = new Request('http://localhost:3000/api/videos?channel=NonExistentChannel')
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.videos).toEqual([])
  })

  it('channel filter is case-sensitive exact match', async () => {
    mockSearchVideos.mockResolvedValue([
      { id: 1, youtubeId: 'fireship-exact', title: 'Exact Case Video', channel: 'Fireship' },
    ])

    const request = new Request('http://localhost:3000/api/videos?channel=fireship')
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.videos).toEqual([])
  })

  it('returns summaryMap field in GET response', async () => {
    const request = new Request('http://localhost:3000/api/videos')
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toHaveProperty('summaryMap')
    expect(typeof data.summaryMap).toBe('object')
  })

  it('existing response fields (videos, stats, focusAreaMap) still present alongside summaryMap', async () => {
    const request = new Request('http://localhost:3000/api/videos')
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toHaveProperty('videos')
    expect(data).toHaveProperty('stats')
    expect(data).toHaveProperty('focusAreaMap')
    expect(data).toHaveProperty('summaryMap')
  })
})
