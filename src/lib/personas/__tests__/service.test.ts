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

  it('excludes walk-003 stopwords (your/what/now) from extracted topics', async () => {
    const channelName = 'Test Creator'

    // Fixture: repeat stopwords many times alongside real domain terms
    // "your" "what" "now" appear frequently but must be filtered out
    // "typescript" "refactoring" "architecture" appear frequently - must survive
    const stopwordSpam = Array(10).fill(
      'your what now just like really going want know think people thing'
    ).join(' ')
    const domainContent = Array(5).fill(
      'typescript refactoring architecture typescript refactoring architecture'
    ).join(' ')

    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([
            { content: `${stopwordSpam} ${domainContent}` },
            { content: `${stopwordSpam} ${domainContent}` },
            { content: `${stopwordSpam} ${domainContent}` },
          ]),
        }),
      }),
    } as never)

    const topics = await extractExpertiseTopics(channelName)

    expect(topics).not.toContain('your')
    expect(topics).not.toContain('what')
    expect(topics).not.toContain('now')
    expect(topics).not.toContain('just')
    expect(topics).not.toContain('like')
    expect(topics).not.toContain('really')
    expect(topics).not.toContain('going')
    expect(topics).not.toContain('want')
    expect(topics).not.toContain('know')
    expect(topics).not.toContain('think')
    expect(topics).not.toContain('people')
    expect(topics).not.toContain('thing')
    // Domain terms must survive
    expect(topics).toContain('typescript')
    expect(topics).toContain('refactoring')
    expect(topics).toContain('architecture')
  })

  it('excludes contraction fragments and spoken fillers (live-rebuild fix)', async () => {
    const channelName = 'Test Creator'

    // Fixture mirrors the live Diary Of A CEO rebuild that produced
    // ["sleep","don","because","yeah","okay"]: negation contractions shed
    // "don"-style fragments via the apostrophe word boundary, and filler
    // words ranked by raw frequency. Domain terms must be what survives.
    const fillerSpam = Array(10).fill(
      "don't doesn't isn't wasn't because yeah okay gonna wanna stuff something"
    ).join(' ')
    const domainContent = Array(5).fill(
      "sleep psychology habits sleep psychology habits the creator's audience"
    ).join(' ')

    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([
            { content: `${fillerSpam} ${domainContent}` },
            { content: `${fillerSpam} ${domainContent}` },
          ]),
        }),
      }),
    } as never)

    const topics = await extractExpertiseTopics(channelName)

    // Contraction fragments must not appear
    expect(topics).not.toContain('don')
    expect(topics).not.toContain('doesn')
    expect(topics).not.toContain('isn')
    expect(topics).not.toContain('wasn')
    // Spoken fillers must not appear
    expect(topics).not.toContain('because')
    expect(topics).not.toContain('yeah')
    expect(topics).not.toContain('okay')
    expect(topics).not.toContain('gonna')
    expect(topics).not.toContain('wanna')
    expect(topics).not.toContain('stuff')
    expect(topics).not.toContain('something')
    // Domain terms survive, and the clitic suffix is stripped ("creator's" -> "creator")
    expect(topics).toContain('sleep')
    expect(topics).toContain('psychology')
    expect(topics).toContain('habits')
    expect(topics).toContain('creator')
  })

  it('keeps high-frequency domain terms', async () => {
    const channelName = 'Test Creator'

    // "deployment" appears many times across chunks - must survive
    const repeatedDomain = Array(15).fill('deployment kubernetes deployment kubernetes deployment').join(' ')

    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([
            { content: repeatedDomain },
            { content: repeatedDomain },
          ]),
        }),
      }),
    } as never)

    const topics = await extractExpertiseTopics(channelName)

    expect(topics).toContain('deployment')
    expect(topics).toContain('kubernetes')
  })

  it('drops singleton noise words', async () => {
    const channelName = 'Test Creator'

    // "flibbertigibbet" appears exactly once - must be excluded by frequency floor
    // "typescript" appears many times - must survive
    const content = [
      Array(5).fill('typescript typescript typescript').join(' '),
      'flibbertigibbet',
    ].join(' ')

    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([
            { content },
          ]),
        }),
      }),
    } as never)

    const topics = await extractExpertiseTopics(channelName)

    expect(topics).not.toContain('flibbertigibbet')
    expect(topics).toContain('typescript')
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

    const existingPersona = {
      id: existingId,
      channelName,
      name: channelName,
      systemPrompt: 'Old prompt',
      expertiseTopics: ['React'],
      expertiseEmbedding: new Array(384).fill(0.1),
      transcriptCount: 5,
      regeneratingAt: null,
      lastRegeneratedAt: null,
      createdAt: new Date(),
    }

    // 1st select: existing persona row check
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([existingPersona]),
        }),
      }),
    } as never)

    // 2nd select: video count for channel (baseline-clear)
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ id: 1 }, { id: 2 }, { id: 3 }]),
      }),
    } as never)

    // 3rd select: transcript samples for generatePersonaSystemPrompt
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([
            { transcript: 'Sample transcript...' },
          ]),
        }),
      }),
    } as never)

    // 4th select: chunk content for extractExpertiseTopics (innerJoin path)
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([
            { content: 'react react typescript typescript' },
            { content: 'react typescript testing testing' },
          ]),
        }),
      }),
    } as never)

    mockGenerateText.mockResolvedValue('Updated v2 system prompt')

    // Mock computeChannelCentroid (used by computeExpertiseEmbedding)
    const { computeChannelCentroid } = await import('@/lib/channels/similarity')
    const mockComputeChannelCentroid = vi.mocked(computeChannelCentroid)
    mockComputeChannelCentroid.mockResolvedValue(new Array(384).fill(0.5))

    const updatedPersona = {
      ...existingPersona,
      systemPrompt: 'Updated v2 system prompt',
      expertiseTopics: ['react', 'typescript', 'testing'],
      lastRegeneratedAt: new Date(),
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

    // First select: existing persona check - returns empty (no persona)
    mockDb.select.mockReturnValueOnce({
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

    // First select: existing persona check - returns empty (no persona row)
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    } as never)

    await expect(regeneratePersonaSystemPrompt(channelName)).rejects.toThrow(
      'No persona found'
    )
  })

  // --- Chunk 3: topics + timestamp + embedding persisted in one update ---

  it('persists fixed topics, lastRegeneratedAt, and rebuilt embedding in one update', async () => {
    const channelName = 'Test Creator'
    const existingPersona = {
      id: 1,
      channelName,
      name: channelName,
      systemPrompt: 'Old prompt',
      expertiseTopics: ['old'],
      expertiseEmbedding: new Array(384).fill(0.1),
      transcriptCount: 7,
      regeneratingAt: null,
      lastRegeneratedAt: null,
      createdAt: new Date(),
    }

    // 1st select: existing persona row check
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([existingPersona]),
        }),
      }),
    } as never)

    // 2nd select: video count for channel (baseline-clear)
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }, { id: 6 }, { id: 7 }]),
      }),
    } as never)

    // 3rd select: transcripts for generatePersonaSystemPrompt
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ transcript: 'Transcript about deployment kubernetes' }]),
        }),
      }),
    } as never)

    // 4th select: chunks for extractExpertiseTopics
    const domainContent = Array(5).fill('deployment kubernetes deployment kubernetes').join(' ')
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([
            { content: domainContent },
            { content: domainContent },
          ]),
        }),
      }),
    } as never)

    mockGenerateText.mockResolvedValue('New system prompt')

    const newEmbedding = new Array(384).fill(0.9)
    const { computeChannelCentroid } = await import('@/lib/channels/similarity')
    vi.mocked(computeChannelCentroid).mockResolvedValue(newEmbedding)

    let capturedSetPayload: Record<string, unknown> = {}
    mockDb.update = vi.fn().mockReturnValue({
      set: vi.fn().mockImplementation((payload: Record<string, unknown>) => {
        capturedSetPayload = payload
        return {
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ ...existingPersona, systemPrompt: 'New system prompt', lastRegeneratedAt: new Date() }]),
          }),
        }
      }),
    })

    await regeneratePersonaSystemPrompt(channelName)

    // All four fields in ONE .set call
    expect(capturedSetPayload).toHaveProperty('systemPrompt', 'New system prompt')
    expect(capturedSetPayload).toHaveProperty('expertiseTopics')
    expect(capturedSetPayload).toHaveProperty('lastRegeneratedAt')
    expect(capturedSetPayload).toHaveProperty('expertiseEmbedding', newEmbedding)
    expect(Array.isArray(capturedSetPayload['expertiseTopics'])).toBe(true)
  })

  it('omits expertiseEmbedding from the update when centroid is null', async () => {
    const channelName = 'Test Creator'
    const existingPersona = {
      id: 1,
      channelName,
      name: channelName,
      systemPrompt: 'Old prompt',
      expertiseTopics: ['old'],
      expertiseEmbedding: new Array(384).fill(0.1), // existing embedding - must NOT be clobbered
      transcriptCount: 7,
      regeneratingAt: null,
      lastRegeneratedAt: null,
      createdAt: new Date(),
    }

    // 1st select: existing persona row
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([existingPersona]),
        }),
      }),
    } as never)

    // 2nd select: video count for channel (baseline-clear)
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]),
      }),
    } as never)

    // 3rd select: transcripts
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ transcript: 'Some transcript' }]),
        }),
      }),
    } as never)

    // 4th select: chunks for topics
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([
            { content: 'deployment deployment kubernetes kubernetes' },
            { content: 'deployment kubernetes' },
          ]),
        }),
      }),
    } as never)

    mockGenerateText.mockResolvedValue('New system prompt')

    // Centroid returns null - no chunk embeddings yet
    const { computeChannelCentroid } = await import('@/lib/channels/similarity')
    vi.mocked(computeChannelCentroid).mockResolvedValue(null)

    let capturedSetPayload: Record<string, unknown> = {}
    mockDb.update = vi.fn().mockReturnValue({
      set: vi.fn().mockImplementation((payload: Record<string, unknown>) => {
        capturedSetPayload = payload
        return {
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ ...existingPersona, systemPrompt: 'New system prompt' }]),
          }),
        }
      }),
    })

    await regeneratePersonaSystemPrompt(channelName)

    // expertiseEmbedding key must be ABSENT - never clobber with null
    expect(Object.prototype.hasOwnProperty.call(capturedSetPayload, 'expertiseEmbedding')).toBe(false)
    // Other fields must still be present
    expect(capturedSetPayload).toHaveProperty('systemPrompt')
    expect(capturedSetPayload).toHaveProperty('expertiseTopics')
    expect(capturedSetPayload).toHaveProperty('lastRegeneratedAt')
  })

  it('does not touch id in the update payload (transcriptCount IS advanced - narrowed from predecessor)', async () => {
    const channelName = 'Test Creator'
    const existingPersona = {
      id: 99,
      channelName,
      name: channelName,
      systemPrompt: 'Old prompt',
      expertiseTopics: ['old'],
      expertiseEmbedding: null,
      transcriptCount: 12,
      regeneratingAt: null,
      lastRegeneratedAt: null,
      createdAt: new Date(),
    }

    // 1st select: existing persona row
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([existingPersona]),
        }),
      }),
    } as never)

    // 2nd select: video count for channel (new - baseline-clear)
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]),
      }),
    } as never)

    // 3rd select: transcripts
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ transcript: 'Some transcript' }]),
        }),
      }),
    } as never)

    // 4th select: chunks for topics
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([
            { content: 'deployment deployment kubernetes kubernetes' },
            { content: 'deployment kubernetes' },
          ]),
        }),
      }),
    } as never)

    mockGenerateText.mockResolvedValue('New prompt')

    const { computeChannelCentroid } = await import('@/lib/channels/similarity')
    vi.mocked(computeChannelCentroid).mockResolvedValue(null)

    let capturedSetPayload: Record<string, unknown> = {}
    mockDb.update = vi.fn().mockReturnValue({
      set: vi.fn().mockImplementation((payload: Record<string, unknown>) => {
        capturedSetPayload = payload
        return {
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([existingPersona]),
          }),
        }
      }),
    })

    await regeneratePersonaSystemPrompt(channelName)

    // id must NOT be in the SET payload (localStorage history keyed by personaId)
    expect(Object.prototype.hasOwnProperty.call(capturedSetPayload, 'id')).toBe(false)
    // transcriptCount IS now in the SET payload (baseline-clear, narrowed from predecessor)
    expect(Object.prototype.hasOwnProperty.call(capturedSetPayload, 'transcriptCount')).toBe(true)
  })

  it('regenerate advances transcript_count to the current channel video count', async () => {
    const channelName = 'Test Creator'
    const existingPersona = {
      id: 7,
      channelName,
      name: channelName,
      systemPrompt: 'Old prompt',
      expertiseTopics: ['old'],
      expertiseEmbedding: new Array(384).fill(0.1),
      transcriptCount: 5,
      regeneratingAt: null,
      lastRegeneratedAt: null,
      createdAt: new Date(),
    }

    const updatedPersonaWith8 = {
      ...existingPersona,
      transcriptCount: 8,
      systemPrompt: 'New system prompt',
      lastRegeneratedAt: new Date(),
    }

    // 1st select: existing persona row
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([existingPersona]),
        }),
      }),
    } as never)

    // 2nd select: video count for channel - returns 8 video rows
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          { id: 1 }, { id: 2 }, { id: 3 }, { id: 4 },
          { id: 5 }, { id: 6 }, { id: 7 }, { id: 8 },
        ]),
      }),
    } as never)

    // 3rd select: transcript samples for generatePersonaSystemPrompt
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ transcript: 'Sample transcript' }]),
        }),
      }),
    } as never)

    // 4th select: chunks for extractExpertiseTopics
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([
            { content: 'deployment deployment kubernetes kubernetes' },
            { content: 'deployment kubernetes' },
          ]),
        }),
      }),
    } as never)

    mockGenerateText.mockResolvedValue('New system prompt')

    const { computeChannelCentroid } = await import('@/lib/channels/similarity')
    vi.mocked(computeChannelCentroid).mockResolvedValue(new Array(384).fill(0.5))

    let capturedSetPayload: Record<string, unknown> = {}
    mockDb.update = vi.fn().mockReturnValue({
      set: vi.fn().mockImplementation((payload: Record<string, unknown>) => {
        capturedSetPayload = payload
        return {
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([updatedPersonaWith8]),
          }),
        }
      }),
    })

    const result = await regeneratePersonaSystemPrompt(channelName)

    // transcript_count must advance to the current channel count (8), not stay at 5
    expect(capturedSetPayload['transcriptCount']).toBe(8)
    expect(result.transcriptCount).toBe(8)
    // id must NOT be touched
    expect(Object.prototype.hasOwnProperty.call(capturedSetPayload, 'id')).toBe(false)
  })
})
