import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  generatePersonaSystemPrompt,
  extractExpertiseTopics,
  computeExpertiseEmbedding,
  createPersona,
  regeneratePersonaSystemPrompt,
} from '../service'
import { db } from '@/lib/db'
import { generateText } from '@/lib/claude/client'

// Mock dependencies
vi.mock('@/lib/db', async () => {
  const actual = await vi.importActual('@/lib/db')
  return {
    ...actual,
    db: {
      select: vi.fn(),
      insert: vi.fn(),
    },
  }
})

vi.mock('@/lib/claude/client', () => ({
  generateText: vi.fn(),
}))

vi.mock('@/lib/channels/similarity', () => ({
  computeChannelCentroid: vi.fn(),
}))

const mockDb = vi.mocked(db)
const mockGenerateText = vi.mocked(generateText)

describe('generatePersonaSystemPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('generates a system prompt from channel content', async () => {
    const channelName = 'Test Creator'

    // Mock transcript samples (no innerJoin — query goes directly from videos)
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([
            { transcript: 'Sample transcript about React and TypeScript...' },
            { transcript: 'Another video about testing and best practices...' },
          ]),
        }),
      }),
    } as never)

    // Mock Claude API response
    mockGenerateText.mockResolvedValue(
      'You are Test Creator, a software engineering educator. Your expertise is in React, TypeScript, and testing. You speak in a clear, practical way, focusing on real-world applications. Answer questions based on your content from your YouTube channel.'
    )

    const systemPrompt = await generatePersonaSystemPrompt(channelName)

    expect(systemPrompt).toContain('Test Creator')
    expect(systemPrompt).toContain('expertise')
    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.stringContaining('Test Creator')
    )
  })

  it('throws error when no transcripts found', async () => {
    const channelName = 'Empty Channel'

    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    } as never)

    await expect(generatePersonaSystemPrompt(channelName)).rejects.toThrow(
      'No transcripts found for channel'
    )
  })

  it('handles Claude API errors gracefully', async () => {
    const channelName = 'Test Creator'

    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([
            { transcript: 'Sample transcript...' },
          ]),
        }),
      }),
    } as never)

    mockGenerateText.mockRejectedValue(new Error('API error'))

    await expect(generatePersonaSystemPrompt(channelName)).rejects.toThrow(
      'API error'
    )
  })
})

describe('extractExpertiseTopics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('extracts top topics from channel chunks', async () => {
    const channelName = 'Test Creator'

    // Mock chunk content data (extractExpertiseTopics still uses innerJoin on chunks)
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([
            { content: 'React hooks and state management patterns' },
            { content: 'TypeScript best practices and type safety' },
            { content: 'Testing with Jest and React Testing Library' },
            { content: 'React performance optimization techniques' },
            { content: 'TypeScript generics and advanced types' },
          ]),
        }),
      }),
    } as never)

    const topics = await extractExpertiseTopics(channelName)

    expect(Array.isArray(topics)).toBe(true)
    expect(topics.length).toBeGreaterThan(0)
    expect(topics.length).toBeLessThanOrEqual(10)
  })

  it('returns empty array when no chunks found', async () => {
    const channelName = 'Empty Channel'

    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      }),
    } as never)

    const topics = await extractExpertiseTopics(channelName)

    expect(topics).toEqual([])
  })
})

describe('computeExpertiseEmbedding', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('computes expertise embedding from top chunks', async () => {
    const channelName = 'Test Creator'

    // Mock the computeChannelCentroid function
    const { computeChannelCentroid } = await import('@/lib/channels/similarity')
    const mockComputeChannelCentroid = vi.mocked(computeChannelCentroid)

    // Create a mock 384-dimensional embedding
    const mockEmbedding = new Array(384).fill(0).map((_, i) => i / 384)
    mockComputeChannelCentroid.mockResolvedValue(mockEmbedding)

    const embedding = await computeExpertiseEmbedding(channelName)

    expect(embedding).toHaveLength(384)
    expect(mockComputeChannelCentroid).toHaveBeenCalledWith(channelName, db)
  })

  it('returns null when no embeddings found', async () => {
    const channelName = 'Empty Channel'

    const { computeChannelCentroid } = await import('@/lib/channels/similarity')
    const mockComputeChannelCentroid = vi.mocked(computeChannelCentroid)
    mockComputeChannelCentroid.mockResolvedValue(null)

    const embedding = await computeExpertiseEmbedding(channelName)

    expect(embedding).toBeNull()
  })
})

describe('createPersona', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates a complete persona with all fields', async () => {
    const channelName = 'Test Creator'

    // Mock video count
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          { id: 1 },
          { id: 2 },
          { id: 3 },
        ]),
      }),
    } as never)

    // Mock transcript samples for system prompt (no innerJoin)
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([
            { transcript: 'Sample transcript...' },
          ]),
        }),
      }),
    } as never)

    // Mock Claude API response
    mockGenerateText.mockResolvedValue(
      'You are Test Creator, an expert in React and TypeScript.'
    )

    // Mock chunk content for topics (extractExpertiseTopics still uses innerJoin)
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([
            { content: 'React hooks tutorial' },
            { content: 'TypeScript patterns' },
          ]),
        }),
      }),
    } as never)

    // Mock embedding computation
    const { computeChannelCentroid } = await import('@/lib/channels/similarity')
    const mockComputeChannelCentroid = vi.mocked(computeChannelCentroid)
    const mockEmbedding = new Array(384).fill(0).map((_, i) => i / 384)
    mockComputeChannelCentroid.mockResolvedValue(mockEmbedding)

    // Mock insert
    const mockPersona = {
      id: 1,
      channelName: 'Test Creator',
      name: 'Test Creator',
      systemPrompt: 'You are Test Creator, an expert in React and TypeScript.',
      expertiseTopics: ['React', 'TypeScript'],
      expertiseEmbedding: mockEmbedding,
      transcriptCount: 3,
      createdAt: new Date(),
    }

    mockDb.insert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([mockPersona]),
      }),
    } as never)

    const persona = await createPersona(channelName)

    expect(persona).toMatchObject({
      channelName: 'Test Creator',
      name: 'Test Creator',
      systemPrompt: expect.stringContaining('Test Creator'),
      transcriptCount: 3,
    })
    expect(mockDb.insert).toHaveBeenCalled()
  })

  it('throws error when channel has no videos', async () => {
    const channelName = 'Empty Channel'

    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    } as never)

    await expect(createPersona(channelName)).rejects.toThrow(
      'No videos found for channel'
    )
  })

  it('uses channelName as display name by default', async () => {
    const channelName = 'Test Creator'

    // Mock video count
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ id: 1 }]),
      }),
    } as never)

    // Mock transcript samples (no innerJoin)
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([
            { transcript: 'Sample...' },
          ]),
        }),
      }),
    } as never)

    // Mock Claude API
    mockGenerateText.mockResolvedValue('System prompt...')

    // Mock topics (extractExpertiseTopics still uses innerJoin)
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([
            { content: 'Content...' },
          ]),
        }),
      }),
    } as never)

    // Mock embedding
    const { computeChannelCentroid } = await import('@/lib/channels/similarity')
    const mockComputeChannelCentroid = vi.mocked(computeChannelCentroid)
    mockComputeChannelCentroid.mockResolvedValue(new Array(384).fill(0.5))

    // Mock insert
    mockDb.insert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([
          {
            id: 1,
            channelName: 'Test Creator',
            name: 'Test Creator',
            systemPrompt: 'System prompt...',
            expertiseTopics: [],
            expertiseEmbedding: new Array(384).fill(0.5),
            transcriptCount: 1,
            createdAt: new Date(),
          },
        ]),
      }),
    } as never)

    const persona = await createPersona(channelName)

    expect(persona.name).toBe('Test Creator')
  })
})

// --- Chunk 2: v2 persona generation + regenerate ---

describe('generatePersonaSystemPrompt - v2 sampling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('samples more than 5 transcripts and caps combined length near 30k chars', async () => {
    const channelName = 'Test Creator'
    let capturedLimit: number | undefined

    // Build a transcript that is long enough to verify the 30k cap
    const longTranscript = 'a'.repeat(4000)

    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockImplementation((n: number) => {
            capturedLimit = n
            // Return 20 transcripts to prove limit(20) is called
            return Promise.resolve(
              Array.from({ length: 20 }, () => ({ transcript: longTranscript }))
            )
          }),
        }),
      }),
    } as never)

    mockGenerateText.mockResolvedValue('Generated v2 persona prompt')

    await generatePersonaSystemPrompt(channelName)

    // Must request at least 20 transcripts
    expect(capturedLimit).toBeGreaterThanOrEqual(20)

    // Must pass combined text to Claude; verify it is capped near 30k chars
    const promptArg = mockGenerateText.mock.calls[0]?.[0] as string
    // The combined transcript is 20 * 4000 = 80k chars; cap must apply (~30k)
    expect(promptArg.length).toBeLessThan(40000)
  })

  it('analysis prompt requests the v2 document fields', async () => {
    const channelName = 'Test Creator'

    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([
            { transcript: 'Sample transcript about React...' },
          ]),
        }),
      }),
    } as never)

    mockGenerateText.mockResolvedValue('Generated v2 persona prompt')

    await generatePersonaSystemPrompt(channelName)

    const promptArg = mockGenerateText.mock.calls[0]?.[0] as string

    // Must request all v2 document fields
    const promptLower = promptArg.toLowerCase()
    expect(promptLower).toMatch(/voice|tone/)
    expect(promptLower).toMatch(/opinion|takes/)
    expect(promptLower).toMatch(/pet peeve/)
    expect(promptLower).toMatch(/basic question/)
    expect(promptLower).toMatch(/socratic|lecture/)
  })
})

describe('regeneratePersonaSystemPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('updates existing persona systemPrompt and preserves id', async () => {
    const channelName = 'Test Creator'
    const existingId = 42

    // Mock transcript fetch for generatePersonaSystemPrompt
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([
            { transcript: 'Sample transcript...' },
          ]),
        }),
      }),
    } as never)

    mockGenerateText.mockResolvedValue('Updated v2 system prompt')

    const updatedPersona = {
      id: existingId,
      channelName,
      name: channelName,
      systemPrompt: 'Updated v2 system prompt',
      expertiseTopics: ['React'],
      expertiseEmbedding: new Array(384).fill(0.1),
      transcriptCount: 5,
      createdAt: new Date(),
    }

    // Mock db.update chain
    mockDb.update = vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([updatedPersona]),
        }),
      }),
    })

    const result = await regeneratePersonaSystemPrompt(channelName)

    expect(result.id).toBe(existingId)
    expect(result.systemPrompt).toBe('Updated v2 system prompt')
    expect(mockDb.update).toHaveBeenCalled()
    // Must NOT call insert
    expect(mockDb.insert).not.toHaveBeenCalled()
  })

  it('throws when channel has no persona or videos', async () => {
    const channelName = 'Ghost Channel'

    // Simulate no transcripts found (generatePersonaSystemPrompt throws first)
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    } as never)

    await expect(regeneratePersonaSystemPrompt(channelName)).rejects.toThrow()
  })

  it('throws when no existing persona row exists to update', async () => {
    const channelName = 'New Channel'

    // Transcripts exist but persona update returns empty array (no row)
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([
            { transcript: 'Has videos but no persona...' },
          ]),
        }),
      }),
    } as never)

    mockGenerateText.mockResolvedValue('New prompt')

    mockDb.update = vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([]),
        }),
      }),
    })

    await expect(regeneratePersonaSystemPrompt(channelName)).rejects.toThrow(
      'No persona found'
    )
  })
})
