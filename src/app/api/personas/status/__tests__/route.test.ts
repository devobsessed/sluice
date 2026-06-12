import { describe, it, expect, beforeEach, vi } from 'vitest'

// Type for channel status response
type ChannelStatus = {
  channelName: string | null
  transcriptCount: number
  personaId: number | null
  personaCreatedAt: string | null
  personaName: string | null
  expertiseTopics: unknown
  lastRegeneratedAt: string | null
  regeneratingAt: string | null
}

// Mock db query results
let mockChannelCountResults: { channelName: string | null; transcriptCount: number }[] = []
let mockPersonaResults: {
  id: number
  channelName: string
  createdAt: Date | null
  name: string
  expertiseTopics: unknown
  lastRegeneratedAt: Date | null
  regeneratingAt: Date | null
}[] = []
let mockShouldThrow = false
let selectCallIndex = 0

vi.mock('@/lib/auth-guards', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth-guards')>()
  return {
    ...actual,
    requireSession: vi.fn().mockResolvedValue(null),
  }
})

vi.mock('@/lib/db', async () => {
  const actual = await vi.importActual<typeof import('@/lib/db')>('@/lib/db')
  return {
    ...actual,
    db: {
      select: vi.fn().mockImplementation(() => {
        if (mockShouldThrow) {
          throw new Error('Database connection failed')
        }
        const idx = selectCallIndex++
        if (idx === 0) {
          // First call: channel counts query
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                groupBy: vi.fn().mockImplementation(() => Promise.resolve(mockChannelCountResults)),
              }),
            }),
          }
        } else {
          // Second call: personas query
          return {
            from: vi.fn().mockResolvedValue(mockPersonaResults),
          }
        }
      }),
    },
  }
})

// Mock PERSONA_THRESHOLD
vi.mock('@/lib/personas/service', () => ({
  PERSONA_THRESHOLD: 5,
}))

// Import after mocking
const { GET } = await import('../route')

describe('GET /api/personas/status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockChannelCountResults = []
    mockPersonaResults = []
    mockShouldThrow = false
    selectCallIndex = 0
  })

  it('returns empty channels array when no videos exist', async () => {
    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.channels).toEqual([])
    expect(data.threshold).toBe(5)
  })

  it('returns channels with transcript counts and no personas', async () => {
    mockChannelCountResults = [
      { channelName: 'Nate B Jones', transcriptCount: 6 },
      { channelName: 'Anthropic', transcriptCount: 1 },
    ]
    // mockPersonaResults stays empty (no personas)

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.channels).toHaveLength(2)
    expect(data.threshold).toBe(5)

    expect(data.channels[0]).toMatchObject({
      channelName: 'Nate B Jones',
      transcriptCount: 6,
      personaId: null,
      personaCreatedAt: null,
    })
    expect(data.channels[1]).toMatchObject({
      channelName: 'Anthropic',
      transcriptCount: 1,
      personaId: null,
      personaCreatedAt: null,
    })
  })

  it('returns channels with personas included', async () => {
    const personaCreatedAt = new Date('2024-02-10T10:00:00Z')
    mockChannelCountResults = [
      { channelName: 'Nate B Jones', transcriptCount: 3 },
      { channelName: 'Anthropic', transcriptCount: 1 },
    ]
    mockPersonaResults = [
      { id: 1, channelName: 'Nate B Jones', createdAt: personaCreatedAt, name: 'Nate', expertiseTopics: null, lastRegeneratedAt: null, regeneratingAt: null },
    ]

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.channels).toHaveLength(2)

    const nateChannel = data.channels.find((c: ChannelStatus) => c.channelName === 'Nate B Jones')
    expect(nateChannel).toMatchObject({
      channelName: 'Nate B Jones',
      transcriptCount: 3,
      personaId: 1,
    })
    expect(nateChannel?.personaCreatedAt).toBeDefined()

    expect(data.channels.find((c: ChannelStatus) => c.channelName === 'Anthropic')).toMatchObject({
      channelName: 'Anthropic',
      transcriptCount: 1,
      personaId: null,
      personaCreatedAt: null,
    })
  })

  it('sorts active personas first, then by transcript count descending', async () => {
    mockChannelCountResults = [
      { channelName: 'Channel A', transcriptCount: 2 },
      { channelName: 'Channel B', transcriptCount: 5 },
      { channelName: 'Channel C', transcriptCount: 3 },
    ]
    mockPersonaResults = [
      { id: 1, channelName: 'Channel A', createdAt: new Date(), name: 'Persona A', expertiseTopics: null, lastRegeneratedAt: null, regeneratingAt: null },
    ]

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.channels).toHaveLength(3)

    // Channel A should be first (has persona)
    expect(data.channels[0].channelName).toBe('Channel A')
    expect(data.channels[0].personaId).not.toBeNull()

    // Channel B and C should follow, sorted by transcript count descending
    expect(data.channels[1].channelName).toBe('Channel B')
    expect(data.channels[1].personaId).toBeNull()
    expect(data.channels[2].channelName).toBe('Channel C')
    expect(data.channels[2].personaId).toBeNull()
  })

  it('handles channels below and above threshold', async () => {
    mockChannelCountResults = [
      { channelName: 'Above Threshold', transcriptCount: 6 },
      { channelName: 'At Threshold', transcriptCount: 5 },
      { channelName: 'Below Threshold', transcriptCount: 3 },
    ]

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.channels).toHaveLength(3)
    expect(data.threshold).toBe(5)

    const belowChannel = data.channels.find((c: ChannelStatus) => c.channelName === 'Below Threshold')
    const atChannel = data.channels.find((c: ChannelStatus) => c.channelName === 'At Threshold')
    const aboveChannel = data.channels.find((c: ChannelStatus) => c.channelName === 'Above Threshold')

    expect(belowChannel?.transcriptCount).toBe(3)
    expect(atChannel?.transcriptCount).toBe(5)
    expect(aboveChannel?.transcriptCount).toBe(6)
  })

  it('returns 500 on database error', async () => {
    mockShouldThrow = true

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Failed to fetch persona status')
  })

  it('status response includes lastRegeneratedAt and regeneratingAt per channel - null when no persona', async () => {
    mockChannelCountResults = [
      { channelName: 'Solo Channel', transcriptCount: 2 },
    ]
    // no personas

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(200)
    const channel = data.channels[0] as ChannelStatus
    expect(channel).toHaveProperty('lastRegeneratedAt', null)
    expect(channel).toHaveProperty('regeneratingAt', null)
  })

  it('status response includes lastRegeneratedAt and regeneratingAt when persona has timestamps', async () => {
    const lastRegenAt = new Date('2026-06-10T12:00:00Z')
    const regenAt = new Date('2026-06-12T09:00:00Z')
    mockChannelCountResults = [
      { channelName: 'Active Channel', transcriptCount: 8 },
    ]
    mockPersonaResults = [
      {
        id: 2,
        channelName: 'Active Channel',
        createdAt: new Date('2026-05-01T00:00:00Z'),
        name: 'Active Persona',
        expertiseTopics: null,
        lastRegeneratedAt: lastRegenAt,
        regeneratingAt: regenAt,
      },
    ]

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(200)
    const channel = data.channels[0] as ChannelStatus
    expect(channel.lastRegeneratedAt).toBe(lastRegenAt.toISOString())
    expect(channel.regeneratingAt).toBe(regenAt.toISOString())
  })

  it('status response includes lastRegeneratedAt null when persona has not been regenerated', async () => {
    mockChannelCountResults = [
      { channelName: 'Fresh Channel', transcriptCount: 5 },
    ]
    mockPersonaResults = [
      {
        id: 3,
        channelName: 'Fresh Channel',
        createdAt: new Date('2026-06-01T00:00:00Z'),
        name: 'Fresh Persona',
        expertiseTopics: null,
        lastRegeneratedAt: null,
        regeneratingAt: null,
      },
    ]

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(200)
    const channel = data.channels[0] as ChannelStatus
    expect(channel.lastRegeneratedAt).toBeNull()
    expect(channel.regeneratingAt).toBeNull()
  })
})
