import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/auth-guards', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth-guards')>()
  return {
    ...actual,
    requireSession: vi.fn().mockResolvedValue(null),
  }
})

let mockChannelResults: { id: number; channelId: string; name: string; feedUrl: string | null; createdAt: Date }[] = []
let mockDiscoveryResults: { youtubeId: string; title: string; channelId: string; channelName: string; publishedAt: Date | null; description: string }[] = []
let mockBankResults: { youtubeId: string; id: number }[] = []
let mockFocusAreaAssignments: { videoId: number; id: number; name: string; color: string | null }[] = []

vi.mock('@/lib/db', async () => {
  const actual = await vi.importActual<typeof import('@/lib/db')>('@/lib/db')
  return {
    ...actual,
    db: {
      select: vi.fn().mockImplementation((fields?: Record<string, unknown>) => {
        // Route based on which fields are selected
        if (fields && 'youtubeId' in fields && 'id' in fields && Object.keys(fields).length === 2) {
          // Bank lookup query: select({ youtubeId: videos.youtubeId, id: videos.id })
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue(mockBankResults),
            }),
          }
        }
        if (fields && 'videoId' in fields) {
          // Focus area assignments query
          return {
            from: vi.fn().mockReturnValue({
              innerJoin: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue(mockFocusAreaAssignments),
              }),
            }),
          }
        }
        // Default: no field selectors (channels and discoveryVideos)
        return {
          from: vi.fn().mockImplementation((table: unknown) => {
            if (table === actual.channels) {
              return Promise.resolve(mockChannelResults)
            }
            // discoveryVideos table — has orderBy
            return {
              orderBy: vi.fn().mockResolvedValue(mockDiscoveryResults),
            }
          }),
        }
      }),
    },
  }
})

// Import after mocking
const { GET } = await import('../route')

describe('GET /api/discovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockChannelResults = []
    mockDiscoveryResults = []
    mockBankResults = []
    mockFocusAreaAssignments = []
  })

  it('returns channels and empty videos when no discovery videos exist', async () => {
    mockChannelResults = [
      { id: 1, channelId: 'UC123', name: 'Fireship', feedUrl: null, createdAt: new Date() },
    ]

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.channels).toHaveLength(1)
    expect(data.channels[0].name).toBe('Fireship')
    expect(data.videos).toEqual([])
  })

  it('returns both channels and videos when data exists', async () => {
    mockChannelResults = [
      { id: 1, channelId: 'UC123', name: 'Fireship', feedUrl: null, createdAt: new Date() },
    ]
    mockDiscoveryResults = [
      {
        youtubeId: 'abc',
        title: 'Test Video',
        channelId: 'UC123',
        channelName: 'Fireship',
        publishedAt: new Date('2026-03-01'),
        description: 'A test description',
      },
    ]

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.channels).toHaveLength(1)
    expect(data.videos).toHaveLength(1)
    expect(data.videos[0].youtubeId).toBe('abc')
    expect(data.videos[0].title).toBe('Test Video')
  })

  it('marks videos as inBank when they exist in the knowledge bank', async () => {
    mockChannelResults = [
      { id: 1, channelId: 'UC123', name: 'Fireship', feedUrl: null, createdAt: new Date() },
    ]
    mockDiscoveryResults = [
      {
        youtubeId: 'in-bank-vid',
        title: 'In Bank Video',
        channelId: 'UC123',
        channelName: 'Fireship',
        publishedAt: new Date('2026-03-01'),
        description: 'desc',
      },
      {
        youtubeId: 'not-in-bank-vid',
        title: 'Not In Bank',
        channelId: 'UC123',
        channelName: 'Fireship',
        publishedAt: new Date('2026-03-02'),
        description: 'desc',
      },
    ]
    mockBankResults = [{ youtubeId: 'in-bank-vid', id: 42 }]

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(200)
    const inBankVideo = data.videos.find((v: { youtubeId: string }) => v.youtubeId === 'in-bank-vid')
    const notInBankVideo = data.videos.find((v: { youtubeId: string }) => v.youtubeId === 'not-in-bank-vid')

    expect(inBankVideo.inBank).toBe(true)
    expect(inBankVideo.bankVideoId).toBe(42)
    expect(notInBankVideo.inBank).toBe(false)
    expect(notInBankVideo.bankVideoId).toBeNull()
  })

  it('includes focus areas on in-bank videos', async () => {
    mockChannelResults = [
      { id: 1, channelId: 'UC123', name: 'Fireship', feedUrl: null, createdAt: new Date() },
    ]
    mockDiscoveryResults = [
      {
        youtubeId: 'vid-with-tags',
        title: 'Tagged Video',
        channelId: 'UC123',
        channelName: 'Fireship',
        publishedAt: new Date('2026-03-01'),
        description: 'desc',
      },
    ]
    mockBankResults = [{ youtubeId: 'vid-with-tags', id: 10 }]
    mockFocusAreaAssignments = [
      { videoId: 10, id: 1, name: 'TypeScript', color: '#3178c6' },
      { videoId: 10, id: 2, name: 'React', color: null },
    ]

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(200)
    const video = data.videos[0]
    expect(video.focusAreas).toHaveLength(2)
    expect(video.focusAreas[0].name).toBe('TypeScript')
    expect(video.focusAreas[0].color).toBe('#3178c6')
    expect(video.focusAreas[1].name).toBe('React')
    expect(video.focusAreas[1].color).toBeNull()
  })

  it('returns empty focusAreas array for videos not in bank', async () => {
    mockChannelResults = [
      { id: 1, channelId: 'UC123', name: 'Fireship', feedUrl: null, createdAt: new Date() },
    ]
    mockDiscoveryResults = [
      {
        youtubeId: 'new-vid',
        title: 'New Video',
        channelId: 'UC123',
        channelName: 'Fireship',
        publishedAt: new Date('2026-03-01'),
        description: 'desc',
      },
    ]
    // No bank results — video not in bank

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.videos[0].inBank).toBe(false)
    expect(data.videos[0].focusAreas).toEqual([])
  })

  it('returns { channels: [], videos: [] } when no channels and no videos', async () => {
    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.channels).toEqual([])
    expect(data.videos).toEqual([])
  })

  it('serializes publishedAt as ISO string', async () => {
    mockChannelResults = [
      { id: 1, channelId: 'UC123', name: 'Fireship', feedUrl: null, createdAt: new Date() },
    ]
    const publishedDate = new Date('2026-03-15T12:00:00Z')
    mockDiscoveryResults = [
      {
        youtubeId: 'dated-vid',
        title: 'Dated Video',
        channelId: 'UC123',
        channelName: 'Fireship',
        publishedAt: publishedDate,
        description: 'desc',
      },
    ]

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.videos[0].publishedAt).toBe(publishedDate.toISOString())
  })

  it('handles null publishedAt gracefully', async () => {
    mockChannelResults = [
      { id: 1, channelId: 'UC123', name: 'Fireship', feedUrl: null, createdAt: new Date() },
    ]
    mockDiscoveryResults = [
      {
        youtubeId: 'no-date-vid',
        title: 'No Date Video',
        channelId: 'UC123',
        channelName: 'Fireship',
        publishedAt: null,
        description: 'desc',
      },
    ]

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.videos[0].publishedAt).toBeNull()
  })
})
