import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock all dependencies before importing the module under test
vi.mock('@/lib/db', () => ({
  db: {
    update: vi.fn(),
    select: vi.fn(),
  },
  videos: {
    id: 'id',
    youtubeId: 'youtube_id',
    title: 'title',
    channel: 'channel',
    thumbnail: 'thumbnail',
    duration: 'duration',
    transcript: 'transcript',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    publishedAt: 'published_at',
  },
  chunks: {
    id: 'id',
    videoId: 'video_id',
    content: 'content',
    startTime: 'start_time',
    endTime: 'end_time',
    embedding: 'embedding',
    createdAt: 'created_at',
  },
}))

vi.mock('@/lib/youtube/transcript', () => ({
  fetchTranscript: vi.fn(),
}))

vi.mock('@/lib/transcript/parse', () => ({
  parseTranscript: vi.fn(),
}))

vi.mock('@/lib/embeddings/chunker', () => ({
  chunkTranscript: vi.fn(),
}))

vi.mock('@/lib/embeddings/service', () => ({
  embedChunks: vi.fn(),
}))

vi.mock('@/lib/automation/queue', () => ({
  enqueueJob: vi.fn(),
}))

vi.mock('@/lib/claude/client', () => ({
  generateText: vi.fn(),
}))

vi.mock('@/lib/claude/prompts/extract', () => ({
  buildExtractionPrompt: vi.fn(),
}))

vi.mock('@/lib/claude/prompts/parser', () => ({
  parsePartialJSON: vi.fn(),
}))

vi.mock('@/lib/db/insights', () => ({
  getExtractionForVideo: vi.fn(),
  upsertExtraction: vi.fn(),
}))

// Import after mocking
import { processJob, processGenerateInsights } from '../processor'
import { db } from '@/lib/db'
import { fetchTranscript } from '@/lib/youtube/transcript'
import { parseTranscript } from '@/lib/transcript/parse'
import { chunkTranscript } from '@/lib/embeddings/chunker'
import { embedChunks } from '@/lib/embeddings/service'
import { enqueueJob } from '@/lib/automation/queue'
import { generateText } from '@/lib/claude/client'
import { buildExtractionPrompt } from '@/lib/claude/prompts/extract'
import { parsePartialJSON } from '@/lib/claude/prompts/parser'
import { getExtractionForVideo, upsertExtraction } from '@/lib/db/insights'
import type { Job } from '@/lib/db/schema'
import type { ExtractionResult } from '@/lib/claude/prompts/types'

describe('processJob', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('routes fetch_transcript type correctly', async () => {
    const job: Job = {
      id: 1,
      type: 'fetch_transcript',
      payload: { videoId: 123, youtubeId: 'abc123' },
      status: 'processing',
      attempts: 1,
      maxAttempts: 3,
      error: null,
      createdAt: new Date(),
      startedAt: new Date(),
      completedAt: null,
    }

    // Mock successful transcript fetch
    vi.mocked(fetchTranscript).mockResolvedValue({
      success: true,
      transcript: '0:00\nTest transcript',
      segments: [{ timestamp: '0:00', seconds: 0, text: 'Test transcript' }],
    })

    // Mock database update
    vi.mocked(db.update).mockReturnValue({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

    vi.mocked(enqueueJob).mockResolvedValue(1)

    await processJob(job)

    expect(fetchTranscript).toHaveBeenCalledWith('abc123')
  })

  it('routes generate_embeddings type correctly', async () => {
    const job: Job = {
      id: 2,
      type: 'generate_embeddings',
      payload: { videoId: 456 },
      status: 'processing',
      attempts: 1,
      maxAttempts: 3,
      error: null,
      createdAt: new Date(),
      startedAt: new Date(),
      completedAt: null,
    }

    const mockVideo = {
      id: 456,
      youtubeId: 'test123',
      title: 'Test Video',
      channel: 'Test Channel',
      transcript: '0:00\nTest transcript',
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    // First db.select() call: get video
    vi.mocked(db.select)
      .mockReturnValueOnce({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([mockVideo]),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
      // Second db.select() call: chunk count -- 0 existing chunks
      .mockReturnValueOnce({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([{ value: 0 }]),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)

    vi.mocked(parseTranscript).mockReturnValue([
      { timestamp: '0:00', seconds: 0, text: 'Test transcript' },
    ])

    vi.mocked(chunkTranscript).mockReturnValue([
      {
        content: 'Test transcript',
        startTime: 0,
        endTime: 0,
        segmentIndices: [0],
      },
    ])

    vi.mocked(embedChunks).mockResolvedValue({
      chunks: [],
      totalChunks: 1,
      successCount: 1,
      errorCount: 0,
      durationMs: 100,
    })

    await processJob(job)

    expect(embedChunks).toHaveBeenCalled()
  })

  it('throws on unknown job type', async () => {
    const job: Job = {
      id: 3,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      type: 'unknown_type' as any,
      payload: {},
      status: 'processing',
      attempts: 1,
      maxAttempts: 3,
      error: null,
      createdAt: new Date(),
      startedAt: new Date(),
      completedAt: null,
    }

    await expect(processJob(job)).rejects.toThrow('Unknown job type: unknown_type')
  })
})

describe('processFetchTranscript', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches transcript and stores it', async () => {
    const job: Job = {
      id: 1,
      type: 'fetch_transcript',
      payload: { videoId: 123, youtubeId: 'abc123' },
      status: 'processing',
      attempts: 1,
      maxAttempts: 3,
      error: null,
      createdAt: new Date(),
      startedAt: new Date(),
      completedAt: null,
    }

    vi.mocked(fetchTranscript).mockResolvedValue({
      success: true,
      transcript: '0:00\nTest transcript content',
      segments: [{ timestamp: '0:00', seconds: 0, text: 'Test transcript content' }],
    })

    const mockSet = vi.fn().mockReturnThis()
    const mockWhere = vi.fn().mockResolvedValue([])
    vi.mocked(db.update).mockReturnValue({
      set: mockSet,
      where: mockWhere,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

    vi.mocked(enqueueJob).mockResolvedValue(1)

    await processJob(job)

    expect(fetchTranscript).toHaveBeenCalledWith('abc123')
    expect(db.update).toHaveBeenCalled()
    expect(mockSet).toHaveBeenCalledWith({
      transcript: '0:00\nTest transcript content',
      updatedAt: expect.any(Date),
    })
    expect(mockWhere).toHaveBeenCalled()
  })

  it('enqueues embedding job after transcript', async () => {
    const job: Job = {
      id: 1,
      type: 'fetch_transcript',
      payload: { videoId: 123, youtubeId: 'abc123' },
      status: 'processing',
      attempts: 1,
      maxAttempts: 3,
      error: null,
      createdAt: new Date(),
      startedAt: new Date(),
      completedAt: null,
    }

    vi.mocked(fetchTranscript).mockResolvedValue({
      success: true,
      transcript: '0:00\nTest transcript',
      segments: [{ timestamp: '0:00', seconds: 0, text: 'Test transcript' }],
    })

    vi.mocked(db.update).mockReturnValue({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

    vi.mocked(enqueueJob).mockResolvedValue(1)

    await processJob(job)

    expect(enqueueJob).toHaveBeenCalledWith('generate_embeddings', { videoId: 123 })
  })

  it('throws on failed transcript fetch', async () => {
    const job: Job = {
      id: 1,
      type: 'fetch_transcript',
      payload: { videoId: 123, youtubeId: 'abc123' },
      status: 'processing',
      attempts: 1,
      maxAttempts: 3,
      error: null,
      createdAt: new Date(),
      startedAt: new Date(),
      completedAt: null,
    }

    vi.mocked(fetchTranscript).mockResolvedValue({
      success: false,
      transcript: null,
      segments: [],
      error: 'Transcript not available',
    })

    await expect(processJob(job)).rejects.toThrow('Transcript fetch failed: Transcript not available')
  })

  it('validates payload with missing videoId', async () => {
    const job: Job = {
      id: 1,
      type: 'fetch_transcript',
      payload: { youtubeId: 'abc123' }, // missing videoId
      status: 'processing',
      attempts: 1,
      maxAttempts: 3,
      error: null,
      createdAt: new Date(),
      startedAt: new Date(),
      completedAt: null,
    }

    await expect(processJob(job)).rejects.toThrow('Invalid transcript job payload')
  })

  it('validates payload with missing youtubeId', async () => {
    const job: Job = {
      id: 1,
      type: 'fetch_transcript',
      payload: { videoId: 123 }, // missing youtubeId
      status: 'processing',
      attempts: 1,
      maxAttempts: 3,
      error: null,
      createdAt: new Date(),
      startedAt: new Date(),
      completedAt: null,
    }

    await expect(processJob(job)).rejects.toThrow('Invalid transcript job payload')
  })

  it('validates payload with wrong types', async () => {
    const job: Job = {
      id: 1,
      type: 'fetch_transcript',
      payload: { videoId: '123', youtubeId: 456 }, // wrong types
      status: 'processing',
      attempts: 1,
      maxAttempts: 3,
      error: null,
      createdAt: new Date(),
      startedAt: new Date(),
      completedAt: null,
    }

    await expect(processJob(job)).rejects.toThrow('Invalid transcript job payload')
  })
})

describe('processGenerateEmbeddings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('parses, chunks, and embeds transcript', async () => {
    const job: Job = {
      id: 2,
      type: 'generate_embeddings',
      payload: { videoId: 456 },
      status: 'processing',
      attempts: 1,
      maxAttempts: 3,
      error: null,
      createdAt: new Date(),
      startedAt: new Date(),
      completedAt: null,
    }

    const mockVideo = {
      id: 456,
      youtubeId: 'test123',
      title: 'Test Video',
      channel: 'Test Channel',
      transcript: '0:00\nTest content\n\n1:00\nMore content',
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    // First db.select() call: get video
    vi.mocked(db.select)
      .mockReturnValueOnce({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([mockVideo]),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
      // Second db.select() call: chunk count -- 0 existing chunks
      .mockReturnValueOnce({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([{ value: 0 }]),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)

    const mockParsed = [
      { timestamp: '0:00', seconds: 0, text: 'Test content' },
      { timestamp: '1:00', seconds: 60, text: 'More content' },
    ]
    vi.mocked(parseTranscript).mockReturnValue(mockParsed)

    const mockChunks = [
      {
        content: 'Test content More content',
        startTime: 0,
        endTime: 60000,
        segmentIndices: [0, 1],
      },
    ]
    vi.mocked(chunkTranscript).mockReturnValue(mockChunks)

    vi.mocked(embedChunks).mockResolvedValue({
      chunks: [],
      totalChunks: 1,
      successCount: 1,
      errorCount: 0,
      durationMs: 100,
    })

    await processJob(job)

    expect(parseTranscript).toHaveBeenCalledWith(mockVideo.transcript)
    expect(chunkTranscript).toHaveBeenCalledWith([
      { text: 'Test content', offset: 0 },
      { text: 'More content', offset: 60000 },
    ])
    expect(embedChunks).toHaveBeenCalledWith(mockChunks, undefined, 456)
  })

  it('throws when video not found', async () => {
    const job: Job = {
      id: 2,
      type: 'generate_embeddings',
      payload: { videoId: 999 },
      status: 'processing',
      attempts: 1,
      maxAttempts: 3,
      error: null,
      createdAt: new Date(),
      startedAt: new Date(),
      completedAt: null,
    }

    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]), // no video found
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

    await expect(processJob(job)).rejects.toThrow('Video 999 not found or has no transcript')
  })

  it('throws when video has no transcript', async () => {
    const job: Job = {
      id: 2,
      type: 'generate_embeddings',
      payload: { videoId: 456 },
      status: 'processing',
      attempts: 1,
      maxAttempts: 3,
      error: null,
      createdAt: new Date(),
      startedAt: new Date(),
      completedAt: null,
    }

    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([
        {
          id: 456,
          youtubeId: 'test123',
          title: 'Test Video',
          channel: 'Test Channel',
          transcript: null, // no transcript
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

    await expect(processJob(job)).rejects.toThrow('Video 456 not found or has no transcript')
  })

  it('validates payload with missing videoId', async () => {
    const job: Job = {
      id: 2,
      type: 'generate_embeddings',
      payload: {}, // missing videoId
      status: 'processing',
      attempts: 1,
      maxAttempts: 3,
      error: null,
      createdAt: new Date(),
      startedAt: new Date(),
      completedAt: null,
    }

    await expect(processJob(job)).rejects.toThrow('Invalid embeddings job payload')
  })

  it('validates payload with wrong type', async () => {
    const job: Job = {
      id: 2,
      type: 'generate_embeddings',
      payload: { videoId: '456' }, // wrong type
      status: 'processing',
      attempts: 1,
      maxAttempts: 3,
      error: null,
      createdAt: new Date(),
      startedAt: new Date(),
      completedAt: null,
    }

    await expect(processJob(job)).rejects.toThrow('Invalid embeddings job payload')
  })

  it('throws when no chunks generated', async () => {
    const job: Job = {
      id: 2,
      type: 'generate_embeddings',
      payload: { videoId: 456 },
      status: 'processing',
      attempts: 1,
      maxAttempts: 3,
      error: null,
      createdAt: new Date(),
      startedAt: new Date(),
      completedAt: null,
    }

    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([
        {
          id: 456,
          youtubeId: 'test123',
          title: 'Test Video',
          channel: 'Test Channel',
          transcript: '0:00\nTest',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

    vi.mocked(parseTranscript).mockReturnValue([
      { timestamp: '0:00', seconds: 0, text: 'Test' },
    ])

    vi.mocked(chunkTranscript).mockReturnValue([]) // no chunks generated

    await expect(processJob(job)).rejects.toThrow('No chunks generated from transcript')
  })

  it('skips embedding when chunks already exist', async () => {
    const job: Job = {
      id: 2,
      type: 'generate_embeddings',
      payload: { videoId: 456 },
      status: 'processing',
      attempts: 1,
      maxAttempts: 3,
      error: null,
      createdAt: new Date(),
      startedAt: new Date(),
      completedAt: null,
    }

    const mockVideo = {
      id: 456,
      youtubeId: 'test123',
      title: 'Test Video',
      channel: 'Test Channel',
      transcript: '0:00\nTest content\n\n1:00\nMore content',
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    // First db.select() call: get video
    vi.mocked(db.select)
      .mockReturnValueOnce({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([mockVideo]),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
      // Second db.select() call: chunk count -- existing chunks match expected count
      .mockReturnValueOnce({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([{ value: 2 }]),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)

    vi.mocked(parseTranscript).mockReturnValue([
      { timestamp: '0:00', seconds: 0, text: 'Test content' },
      { timestamp: '1:00', seconds: 60, text: 'More content' },
    ])

    // chunkTranscript returns 2 chunks -- same as existing count
    vi.mocked(chunkTranscript).mockReturnValue([
      {
        content: 'Test content',
        startTime: 0,
        endTime: 60000,
        segmentIndices: [0],
      },
      {
        content: 'More content',
        startTime: 60000,
        endTime: 120000,
        segmentIndices: [1],
      },
    ])

    await processJob(job)

    // embedChunks must NOT be called when chunks already exist
    expect(embedChunks).not.toHaveBeenCalled()
  })

  it('proceeds with embedding when chunk count is less than expected', async () => {
    const job: Job = {
      id: 2,
      type: 'generate_embeddings',
      payload: { videoId: 456 },
      status: 'processing',
      attempts: 1,
      maxAttempts: 3,
      error: null,
      createdAt: new Date(),
      startedAt: new Date(),
      completedAt: null,
    }

    const mockVideo = {
      id: 456,
      youtubeId: 'test123',
      title: 'Test Video',
      channel: 'Test Channel',
      transcript: '0:00\nTest content\n\n1:00\nMore content',
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    // First db.select() call: get video
    vi.mocked(db.select)
      .mockReturnValueOnce({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([mockVideo]),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
      // Second db.select() call: chunk count -- 0 existing chunks (none yet)
      .mockReturnValueOnce({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([{ value: 0 }]),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)

    vi.mocked(parseTranscript).mockReturnValue([
      { timestamp: '0:00', seconds: 0, text: 'Test content' },
      { timestamp: '1:00', seconds: 60, text: 'More content' },
    ])

    const mockChunks = [
      {
        content: 'Test content',
        startTime: 0,
        endTime: 60000,
        segmentIndices: [0],
      },
      {
        content: 'More content',
        startTime: 60000,
        endTime: 120000,
        segmentIndices: [1],
      },
    ]
    vi.mocked(chunkTranscript).mockReturnValue(mockChunks)

    vi.mocked(embedChunks).mockResolvedValue({
      chunks: [],
      totalChunks: 2,
      successCount: 2,
      errorCount: 0,
      durationMs: 200,
    })

    await processJob(job)

    // embedChunks MUST be called when chunk count is below expected
    expect(embedChunks).toHaveBeenCalledWith(mockChunks, undefined, 456)
  })
})

describe('processGenerateInsights', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('generates and persists insights for a video', async () => {
    const mockVideo = {
      id: 42,
      youtubeId: 'test123',
      title: 'Test Video',
      channel: 'Test Channel',
      transcript: '0:00\nTest transcript content',
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    const mockExtraction: ExtractionResult = {
      contentType: 'dev',
      summary: {
        tldr: 'Test TLDR',
        overview: 'Test overview',
        keyPoints: ['Point 1'],
      },
      insights: [{
        title: 'Insight 1',
        timestamp: '0:00',
        explanation: 'Explanation',
        actionable: 'Do this',
      }],
      actionItems: {
        immediate: ['Action 1'],
        shortTerm: [],
        longTerm: [],
        resources: [],
      },
      claudeCode: {
        applicable: false,
        skills: [],
        commands: [],
        agents: [],
        hooks: [],
        rules: [],
      },
    }

    // No existing insights
    vi.mocked(getExtractionForVideo).mockResolvedValue(null)

    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([mockVideo]),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

    vi.mocked(buildExtractionPrompt).mockReturnValue('test prompt')
    vi.mocked(generateText).mockResolvedValue(JSON.stringify(mockExtraction))
    vi.mocked(parsePartialJSON).mockReturnValue(mockExtraction)
    vi.mocked(upsertExtraction).mockResolvedValue({
      id: 'test-id',
      videoId: 42,
      contentType: 'dev',
      extraction: mockExtraction,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    await processGenerateInsights({ videoId: 42 })

    expect(getExtractionForVideo).toHaveBeenCalledWith(42)
    expect(buildExtractionPrompt).toHaveBeenCalledWith({
      title: 'Test Video',
      channel: 'Test Channel',
      transcript: '0:00\nTest transcript content',
    })
    expect(generateText).toHaveBeenCalledWith('test prompt')
    expect(parsePartialJSON).toHaveBeenCalled()
    expect(upsertExtraction).toHaveBeenCalledWith(42, mockExtraction)
  })

  it('skips generation when insights already exist', async () => {
    vi.mocked(getExtractionForVideo).mockResolvedValue({
      id: 'existing-id',
      videoId: 42,
      contentType: 'dev',
      extraction: {} as ExtractionResult,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    await processGenerateInsights({ videoId: 42 })

    // Should not call Claude API
    expect(generateText).not.toHaveBeenCalled()
    expect(upsertExtraction).not.toHaveBeenCalled()
  })

  it('throws on invalid payload', async () => {
    await expect(processGenerateInsights({ videoId: '42' }))
      .rejects.toThrow('Invalid insights job payload')

    await expect(processGenerateInsights({}))
      .rejects.toThrow('Invalid insights job payload')
  })

  it('throws when video not found', async () => {
    vi.mocked(getExtractionForVideo).mockResolvedValue(null)

    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

    await expect(processGenerateInsights({ videoId: 999 }))
      .rejects.toThrow('Video 999 not found')
  })

  it('throws when video has no transcript', async () => {
    vi.mocked(getExtractionForVideo).mockResolvedValue(null)

    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{
        id: 42,
        title: 'Test',
        channel: null,
        transcript: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }]),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

    await expect(processGenerateInsights({ videoId: 42 }))
      .rejects.toThrow('Video 42 has no transcript')
  })

  it('throws on empty Claude response', async () => {
    vi.mocked(getExtractionForVideo).mockResolvedValue(null)

    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{
        id: 42,
        title: 'Test',
        channel: 'Channel',
        transcript: '0:00\nTest',
        createdAt: new Date(),
        updatedAt: new Date(),
      }]),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

    vi.mocked(buildExtractionPrompt).mockReturnValue('prompt')
    vi.mocked(generateText).mockResolvedValue('')

    await expect(processGenerateInsights({ videoId: 42 }))
      .rejects.toThrow('Claude returned empty response for video 42')
  })

  it('throws on failed JSON parse', async () => {
    vi.mocked(getExtractionForVideo).mockResolvedValue(null)

    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{
        id: 42,
        title: 'Test',
        channel: 'Channel',
        transcript: '0:00\nTest',
        createdAt: new Date(),
        updatedAt: new Date(),
      }]),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

    vi.mocked(buildExtractionPrompt).mockReturnValue('prompt')
    vi.mocked(generateText).mockResolvedValue('not json')
    vi.mocked(parsePartialJSON).mockReturnValue(null)

    await expect(processGenerateInsights({ videoId: 42 }))
      .rejects.toThrow('Failed to parse extraction response for video 42')
  })

  it('throws on incomplete extraction (missing required sections)', async () => {
    vi.mocked(getExtractionForVideo).mockResolvedValue(null)

    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{
        id: 42,
        title: 'Test',
        channel: 'Channel',
        transcript: '0:00\nTest',
        createdAt: new Date(),
        updatedAt: new Date(),
      }]),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

    vi.mocked(buildExtractionPrompt).mockReturnValue('prompt')
    vi.mocked(generateText).mockResolvedValue('{"contentType": "dev"}')
    // Partial result - only contentType, missing summary/insights/actionItems
    vi.mocked(parsePartialJSON).mockReturnValue({ contentType: 'dev' })

    await expect(processGenerateInsights({ videoId: 42 }))
      .rejects.toThrow('Incomplete extraction for video 42: missing required sections')
  })

  it('fills in default claudeCode when missing from extraction', async () => {
    const mockVideo = {
      id: 42,
      title: 'Test',
      channel: 'Channel',
      transcript: '0:00\nTest',
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    const parsedWithoutClaudeCode = {
      contentType: 'educational' as const,
      summary: { tldr: 'TLDR', overview: 'Overview', keyPoints: ['Point'] },
      insights: [{ title: 'I', timestamp: '0:00', explanation: 'E', actionable: 'A' }],
      actionItems: { immediate: [], shortTerm: [], longTerm: [], resources: [] },
      // No claudeCode field
    }

    vi.mocked(getExtractionForVideo).mockResolvedValue(null)
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([mockVideo]),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    vi.mocked(buildExtractionPrompt).mockReturnValue('prompt')
    vi.mocked(generateText).mockResolvedValue('json')
    vi.mocked(parsePartialJSON).mockReturnValue(parsedWithoutClaudeCode)
    vi.mocked(upsertExtraction).mockResolvedValue({
      id: 'id',
      videoId: 42,
      contentType: 'educational',
      extraction: {} as ExtractionResult,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    await processGenerateInsights({ videoId: 42 })

    // Verify upsertExtraction was called with claudeCode filled in
    expect(upsertExtraction).toHaveBeenCalledWith(42, expect.objectContaining({
      claudeCode: {
        applicable: false,
        skills: [],
        commands: [],
        agents: [],
        hooks: [],
        rules: [],
      },
    }))
  })

  it('passes null channel as empty string to buildExtractionPrompt', async () => {
    vi.mocked(getExtractionForVideo).mockResolvedValue(null)

    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{
        id: 42,
        title: 'Transcript Title',
        channel: null,
        transcript: '0:00\nTest',
        createdAt: new Date(),
        updatedAt: new Date(),
      }]),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

    const fullExtraction: ExtractionResult = {
      contentType: 'general',
      summary: { tldr: 'T', overview: 'O', keyPoints: [] },
      insights: [{ title: 'I', timestamp: '0:00', explanation: 'E', actionable: 'A' }],
      actionItems: { immediate: [], shortTerm: [], longTerm: [], resources: [] },
      claudeCode: { applicable: false, skills: [], commands: [], agents: [], hooks: [], rules: [] },
    }

    vi.mocked(buildExtractionPrompt).mockReturnValue('prompt')
    vi.mocked(generateText).mockResolvedValue('json')
    vi.mocked(parsePartialJSON).mockReturnValue(fullExtraction)
    vi.mocked(upsertExtraction).mockResolvedValue({
      id: 'id',
      videoId: 42,
      contentType: 'general',
      extraction: fullExtraction,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    await processGenerateInsights({ videoId: 42 })

    expect(buildExtractionPrompt).toHaveBeenCalledWith({
      title: 'Transcript Title',
      channel: '',
      transcript: '0:00\nTest',
    })
  })
})
