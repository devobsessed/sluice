import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import {
  registerSearchRag,
  registerGetListOfCreators,
  registerChatWithPersona,
  registerEnsembleQuery,
} from '../tools'
import type { SearchResult } from '@/lib/search/types'
import type { VideoResult } from '@/lib/search/aggregate'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { db } from '@/lib/db'

// Mock dependencies
vi.mock('@/lib/search/hybrid-search', () => ({
  hybridSearch: vi.fn(),
}))

vi.mock('@/lib/search/aggregate', () => ({
  aggregateByVideo: vi.fn(),
}))

vi.mock('@/lib/db/search', () => ({
  getDistinctChannels: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(),
  },
  chunks: {},
  videos: {},
  personas: {},
}))

vi.mock('@/lib/embeddings/pipeline', () => ({
  generateEmbedding: vi.fn(),
}))

vi.mock('@/lib/db/insights', () => ({
  getExtractionForVideo: vi.fn(),
}))

vi.mock('@/lib/claude/client', () => ({
  generateText: vi.fn(),
}))

vi.mock('@/lib/personas/context', () => ({
  getPersonaContext: vi.fn(),
  formatContextForPrompt: vi.fn(),
}))

vi.mock('@/lib/personas/ensemble', () => ({
  findBestPersonas: vi.fn(),
}))

// Pass through streaming module unchanged so real buildSystemParamForMcp is used
vi.mock('@/lib/personas/streaming', async (importOriginal) => {
  return await importOriginal<typeof import('@/lib/personas/streaming')>()
})

// Import mocked functions
import { hybridSearch } from '@/lib/search/hybrid-search'
import { aggregateByVideo } from '@/lib/search/aggregate'
import { getDistinctChannels } from '@/lib/db/search'
import { generateText } from '@/lib/claude/client'
import { getPersonaContext, formatContextForPrompt } from '@/lib/personas/context'
import { findBestPersonas } from '@/lib/personas/ensemble'

describe('registerSearchRag', () => {
  let mockServer: {
    registerTool: Mock
  }
  let toolHandler: (params: { topic: string; creator?: string; limit?: number }) => Promise<{
    content: Array<{ type: string; text: string }>
  }>

  beforeEach(() => {
    vi.clearAllMocks()

    // Create mock server that captures the tool handler
    mockServer = {
      registerTool: vi.fn((name, config, handler) => {
        toolHandler = handler
      }),
    }

    // Register the tool
    registerSearchRag(mockServer as unknown as McpServer)
  })

  it('registers search_rag tool with correct configuration', () => {
    expect(mockServer.registerTool).toHaveBeenCalledTimes(1)
    expect(mockServer.registerTool).toHaveBeenCalledWith(
      'search_rag',
      expect.objectContaining({
        title: 'Search RAG',
        description: expect.any(String),
        inputSchema: expect.any(Object),
      }),
      expect.any(Function)
    )
  })

  // FIRST test - global path unchanged when no creator provided
  it('search_rag without creator is global and unchanged', async () => {
    const mockSearchResults: SearchResult[] = []
    const mockVideoResults: VideoResult[] = []

    ;(hybridSearch as Mock).mockResolvedValue({ results: mockSearchResults, degraded: false })
    ;(aggregateByVideo as Mock).mockReturnValue(mockVideoResults)

    await toolHandler({ topic: 'TypeScript' })

    // No creator: hybridSearch called with limit only, no channel, no resolution
    expect(hybridSearch).toHaveBeenCalledWith('TypeScript', { limit: 10 })
    expect(getDistinctChannels).not.toHaveBeenCalled()
  })

  it('searches knowledge base with topic only', async () => {
    const mockSearchResults: SearchResult[] = [
      {
        chunkId: 1,
        content: 'TypeScript is great',
        startTime: 0,
        endTime: 10,
        similarity: 0.9,
        videoId: 1,
        videoTitle: 'TypeScript Basics',
        channel: 'Dev Channel',
        youtubeId: 'abc123',
        thumbnail: 'https://example.com/thumb.jpg',
        publishedAt: null,
      },
    ]

    const mockVideoResults: VideoResult[] = [
      {
        videoId: 1,
        youtubeId: 'abc123',
        title: 'TypeScript Basics',
        channel: 'Dev Channel',
        thumbnail: 'https://example.com/thumb.jpg',
        score: 0.9,
        matchedChunks: 1,
        bestChunk: {
          content: 'TypeScript is great',
          startTime: 0,
          similarity: 0.9,
        },
      },
    ]

    ;(hybridSearch as Mock).mockResolvedValue({ results: mockSearchResults, degraded: false })
    ;(aggregateByVideo as Mock).mockReturnValue(mockVideoResults)

    const result = await toolHandler({ topic: 'TypeScript' })

    expect(hybridSearch).toHaveBeenCalledWith('TypeScript', { limit: 10 })
    expect(aggregateByVideo).toHaveBeenCalledWith(mockSearchResults)
    expect(result).toEqual({
      content: [{ type: 'text', text: JSON.stringify(mockVideoResults, null, 2) }],
    })
  })

  it('search_rag resolves creator to exact channel and scopes search', async () => {
    const mockChannels = [
      { channel: 'Dev Channel', videoCount: 10 },
      { channel: 'JS Channel', videoCount: 5 },
    ]
    const mockSearchResults: SearchResult[] = [
      {
        chunkId: 1,
        content: 'React hooks',
        startTime: 0,
        endTime: 10,
        similarity: 0.9,
        videoId: 1,
        videoTitle: 'React Tutorial',
        channel: 'Dev Channel',
        youtubeId: 'abc123',
        thumbnail: 'https://example.com/thumb1.jpg',
        publishedAt: null,
      },
    ]
    const mockVideoResults: VideoResult[] = [
      {
        videoId: 1,
        youtubeId: 'abc123',
        title: 'React Tutorial',
        channel: 'Dev Channel',
        thumbnail: 'https://example.com/thumb1.jpg',
        score: 0.9,
        matchedChunks: 1,
        bestChunk: {
          content: 'React hooks',
          startTime: 0,
          similarity: 0.9,
        },
      },
    ]

    ;(getDistinctChannels as Mock).mockResolvedValue(mockChannels)
    ;(hybridSearch as Mock).mockResolvedValue({ results: mockSearchResults, degraded: false })
    ;(aggregateByVideo as Mock).mockReturnValue(mockVideoResults)

    const result = await toolHandler({ topic: 'React', creator: 'Dev' })

    // Resolution step ran
    expect(getDistinctChannels).toHaveBeenCalledTimes(1)
    // hybridSearch called with resolved exact channel name
    expect(hybridSearch).toHaveBeenCalledWith('React', { limit: 10, channel: 'Dev Channel' })
    // aggregateByVideo receives scoped results directly (no post-filter)
    expect(aggregateByVideo).toHaveBeenCalledWith(mockSearchResults)
    expect(result).toEqual({
      content: [{ type: 'text', text: JSON.stringify(mockVideoResults, null, 2) }],
    })
  })

  it('search_rag creator resolution is case-insensitive substring', async () => {
    const mockChannels = [
      { channel: 'JavaScript Mastery', videoCount: 20 },
      { channel: 'Python Pro', videoCount: 8 },
    ]

    ;(getDistinctChannels as Mock).mockResolvedValue(mockChannels)
    ;(hybridSearch as Mock).mockResolvedValue({ results: [], degraded: false })
    ;(aggregateByVideo as Mock).mockReturnValue([])

    await toolHandler({ topic: 'test', creator: 'MASTERY' })

    // 'MASTERY' should match 'JavaScript Mastery' case-insensitively
    expect(hybridSearch).toHaveBeenCalledWith('test', { limit: 10, channel: 'JavaScript Mastery' })
  })

  it('search_rag with unresolvable creator returns empty, hybridSearch not called with bogus channel', async () => {
    const mockChannels = [
      { channel: 'Channel A', videoCount: 5 },
    ]

    ;(getDistinctChannels as Mock).mockResolvedValue(mockChannels)
    ;(aggregateByVideo as Mock).mockReturnValue([])

    const result = await toolHandler({ topic: 'test', creator: 'Channel B' })

    // No channel resolved - hybridSearch should not be called at all
    expect(hybridSearch).not.toHaveBeenCalled()
    // Result should be empty
    expect(aggregateByVideo).toHaveBeenCalledWith([])
    expect(result.content[0]?.text).toContain('[]')
  })

  it('respects custom limit parameter with creator', async () => {
    const mockChannels = [
      { channel: 'Dev Channel', videoCount: 10 },
    ]

    ;(getDistinctChannels as Mock).mockResolvedValue(mockChannels)
    ;(hybridSearch as Mock).mockResolvedValue({ results: [], degraded: false })
    ;(aggregateByVideo as Mock).mockReturnValue([])

    await toolHandler({ topic: 'test', creator: 'Dev', limit: 25 })

    expect(hybridSearch).toHaveBeenCalledWith('test', { limit: 25, channel: 'Dev Channel' })
  })

  it('respects custom limit parameter', async () => {
    const mockSearchResults: SearchResult[] = []
    const mockVideoResults: VideoResult[] = []

    ;(hybridSearch as Mock).mockResolvedValue({ results: mockSearchResults, degraded: false })
    ;(aggregateByVideo as Mock).mockReturnValue(mockVideoResults)

    await toolHandler({ topic: 'test', limit: 25 })

    expect(hybridSearch).toHaveBeenCalledWith('test', { limit: 25 })
  })

  it('uses default limit of 10 when not provided', async () => {
    const mockSearchResults: SearchResult[] = []
    const mockVideoResults: VideoResult[] = []

    ;(hybridSearch as Mock).mockResolvedValue({ results: mockSearchResults, degraded: false })
    ;(aggregateByVideo as Mock).mockReturnValue(mockVideoResults)

    await toolHandler({ topic: 'test' })

    expect(hybridSearch).toHaveBeenCalledWith('test', { limit: 10 })
  })

  it('handles empty search results', async () => {
    ;(hybridSearch as Mock).mockResolvedValue({ results: [], degraded: false })
    ;(aggregateByVideo as Mock).mockReturnValue([])

    const result = await toolHandler({ topic: 'nonexistent' })

    expect(aggregateByVideo).toHaveBeenCalledWith([])
    expect(result).toEqual({
      content: [{ type: 'text', text: JSON.stringify([], null, 2) }],
    })
  })

  it('handles null thumbnail gracefully', async () => {
    const mockSearchResults: SearchResult[] = [
      {
        chunkId: 1,
        content: 'Content',
        startTime: 0,
        endTime: 10,
        similarity: 0.9,
        videoId: 1,
        videoTitle: 'Video 1',
        channel: 'Channel A',
        youtubeId: 'abc123',
        thumbnail: null,
      },
    ]

    const mockVideoResults: VideoResult[] = [
      {
        videoId: 1,
        youtubeId: 'abc123',
        title: 'Video 1',
        channel: 'Channel A',
        thumbnail: null,
        score: 0.9,
        matchedChunks: 1,
        bestChunk: {
          content: 'Content',
          startTime: 0,
          similarity: 0.9,
        },
      },
    ]

    ;(hybridSearch as Mock).mockResolvedValue({ results: mockSearchResults, degraded: false })
    ;(aggregateByVideo as Mock).mockReturnValue(mockVideoResults)

    const result = await toolHandler({ topic: 'test' })

    expect(result.content[0]?.text).toContain('"thumbnail": null')
  })

  it('handles null startTime gracefully', async () => {
    const mockSearchResults: SearchResult[] = [
      {
        chunkId: 1,
        content: 'Content',
        startTime: null,
        endTime: null,
        similarity: 0.9,
        videoId: 1,
        videoTitle: 'Video 1',
        channel: 'Channel A',
        youtubeId: 'abc123',
        thumbnail: null,
      },
    ]

    const mockVideoResults: VideoResult[] = [
      {
        videoId: 1,
        youtubeId: 'abc123',
        title: 'Video 1',
        channel: 'Channel A',
        thumbnail: null,
        score: 0.9,
        matchedChunks: 1,
        bestChunk: {
          content: 'Content',
          startTime: null,
          similarity: 0.9,
        },
      },
    ]

    ;(hybridSearch as Mock).mockResolvedValue({ results: mockSearchResults, degraded: false })
    ;(aggregateByVideo as Mock).mockReturnValue(mockVideoResults)

    const result = await toolHandler({ topic: 'test' })

    expect(result.content[0]?.text).toContain('"startTime": null')
  })

  it('includes knowledgePrompt in results when available', async () => {
    const mockSearchResults: SearchResult[] = [
      {
        chunkId: 1,
        content: 'TypeScript is great',
        startTime: 0,
        endTime: 10,
        similarity: 0.9,
        videoId: 1,
        videoTitle: 'TypeScript Basics',
        channel: 'Dev Channel',
        youtubeId: 'abc123',
        thumbnail: 'https://example.com/thumb.jpg',
        publishedAt: null,
      },
    ]

    const mockVideoResults: VideoResult[] = [
      {
        videoId: 1,
        youtubeId: 'abc123',
        title: 'TypeScript Basics',
        channel: 'Dev Channel',
        thumbnail: 'https://example.com/thumb.jpg',
        score: 0.9,
        matchedChunks: 1,
        bestChunk: {
          content: 'TypeScript is great',
          startTime: 0,
          similarity: 0.9,
        },
      },
    ]

    const mockExtraction = {
      id: 'test-id',
      videoId: 1,
      contentType: 'dev',
      extraction: {
        contentType: 'dev' as const,
        summary: { tldr: 'Test', overview: 'Test', keyPoints: [] },
        insights: [],
        actionItems: { immediate: [], shortTerm: [], longTerm: [], resources: [] },
        knowledgePrompt: 'This video teaches TypeScript best practices. Key techniques include: using strict mode, leveraging type inference, and avoiding any types. The presenter demonstrates with real examples from production code.',
        claudeCode: { applicable: false, skills: [], commands: [], agents: [], hooks: [], rules: [] },
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    ;(hybridSearch as Mock).mockResolvedValue({ results: mockSearchResults, degraded: false })
    ;(aggregateByVideo as Mock).mockReturnValue(mockVideoResults)

    // Mock getExtractionForVideo
    const { getExtractionForVideo } = await import('@/lib/db/insights')
    vi.mocked(getExtractionForVideo).mockResolvedValue(mockExtraction)

    const result = await toolHandler({ topic: 'TypeScript' })

    expect(result.content[0]?.text).toContain('TypeScript best practices')
    expect(result.content[0]?.text).toContain('Knowledge Prompt')
  })

  it('handles videos without knowledgePrompt gracefully', async () => {
    const mockSearchResults: SearchResult[] = [
      {
        chunkId: 1,
        content: 'Content',
        startTime: 0,
        endTime: 10,
        similarity: 0.9,
        videoId: 1,
        videoTitle: 'Old Video',
        channel: 'Channel',
        youtubeId: 'abc123',
        thumbnail: null,
        publishedAt: null,
      },
    ]

    const mockVideoResults: VideoResult[] = [
      {
        videoId: 1,
        youtubeId: 'abc123',
        title: 'Old Video',
        channel: 'Channel',
        thumbnail: null,
        score: 0.9,
        matchedChunks: 1,
        bestChunk: {
          content: 'Content',
          startTime: 0,
          similarity: 0.9,
        },
      },
    ]

    const mockExtraction = {
      id: 'test-id',
      videoId: 1,
      contentType: 'dev',
      extraction: {
        contentType: 'dev' as const,
        summary: { tldr: 'Test', overview: 'Test', keyPoints: [] },
        insights: [],
        actionItems: { immediate: [], shortTerm: [], longTerm: [], resources: [] },
        // No knowledgePrompt field (old extraction)
        claudeCode: { applicable: false, skills: [], commands: [], agents: [], hooks: [], rules: [] },
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    ;(hybridSearch as Mock).mockResolvedValue({ results: mockSearchResults, degraded: false })
    ;(aggregateByVideo as Mock).mockReturnValue(mockVideoResults)

    const { getExtractionForVideo } = await import('@/lib/db/insights')
    vi.mocked(getExtractionForVideo).mockResolvedValue(mockExtraction)

    const result = await toolHandler({ topic: 'test' })

    // Should not crash, just skip the knowledge prompt
    expect(result.content[0]?.text).toBeDefined()
    expect(result.content[0]?.text).not.toContain('Knowledge Prompt')
  })

  it('handles videos with no extraction data gracefully', async () => {
    const mockSearchResults: SearchResult[] = [
      {
        chunkId: 1,
        content: 'Content',
        startTime: 0,
        endTime: 10,
        similarity: 0.9,
        videoId: 1,
        videoTitle: 'Video',
        channel: 'Channel',
        youtubeId: 'abc123',
        thumbnail: null,
        publishedAt: null,
      },
    ]

    const mockVideoResults: VideoResult[] = [
      {
        videoId: 1,
        youtubeId: 'abc123',
        title: 'Video',
        channel: 'Channel',
        thumbnail: null,
        score: 0.9,
        matchedChunks: 1,
        bestChunk: {
          content: 'Content',
          startTime: 0,
          similarity: 0.9,
        },
      },
    ]

    ;(hybridSearch as Mock).mockResolvedValue({ results: mockSearchResults, degraded: false })
    ;(aggregateByVideo as Mock).mockReturnValue(mockVideoResults)

    const { getExtractionForVideo } = await import('@/lib/db/insights')
    vi.mocked(getExtractionForVideo).mockResolvedValue(null)

    const result = await toolHandler({ topic: 'test' })

    // Should not crash, just return results without knowledge prompts
    expect(result.content[0]?.text).toBeDefined()
    expect(result.content[0]?.text).not.toContain('Knowledge Prompt')
  })
})

describe('registerGetListOfCreators', () => {
  let mockServer: {
    registerTool: Mock
  }
  let toolHandler: () => Promise<{
    content: Array<{ type: string; text: string }>
  }>

  beforeEach(() => {
    vi.clearAllMocks()

    // Create mock server that captures the tool handler
    mockServer = {
      registerTool: vi.fn((name, config, handler) => {
        toolHandler = handler
      }),
    }

    // Register the tool
    registerGetListOfCreators(mockServer as unknown as McpServer)
  })

  it('registers get_list_of_creators tool with correct configuration', () => {
    expect(mockServer.registerTool).toHaveBeenCalledTimes(1)
    expect(mockServer.registerTool).toHaveBeenCalledWith(
      'get_list_of_creators',
      expect.objectContaining({
        title: 'Get List of Creators',
        description: expect.any(String),
        inputSchema: {},
      }),
      expect.any(Function)
    )
  })

  it('returns creators with video counts sorted by count descending', async () => {
    const mockCreators = [
      { channel: 'JavaScript Mastery', videoCount: 15 },
      { channel: 'Fireship', videoCount: 10 },
      { channel: 'Web Dev Simplified', videoCount: 5 },
    ]

    ;(getDistinctChannels as Mock).mockResolvedValue(mockCreators)

    const result = await toolHandler()

    expect(getDistinctChannels).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      content: [{ type: 'text', text: JSON.stringify(mockCreators, null, 2) }],
    })
  })

  it('returns empty array when no videos exist', async () => {
    ;(getDistinctChannels as Mock).mockResolvedValue([])

    const result = await toolHandler()

    expect(getDistinctChannels).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      content: [{ type: 'text', text: JSON.stringify([], null, 2) }],
    })
  })

  it('handles single creator correctly', async () => {
    const mockCreators = [
      { channel: 'Solo Creator', videoCount: 1 },
    ]

    ;(getDistinctChannels as Mock).mockResolvedValue(mockCreators)

    const result = await toolHandler()

    expect(result.content[0]?.text).toContain('Solo Creator')
    expect(result.content[0]?.text).toContain('"videoCount": 1')
  })

  it('preserves exact order from database query', async () => {
    const mockCreators = [
      { channel: 'Creator A', videoCount: 100 },
      { channel: 'Creator B', videoCount: 50 },
      { channel: 'Creator C', videoCount: 25 },
    ]

    ;(getDistinctChannels as Mock).mockResolvedValue(mockCreators)

    const result = await toolHandler()
    const parsed = JSON.parse(result.content[0]?.text ?? '[]')

    expect(parsed).toEqual(mockCreators)
    expect(parsed[0]?.channel).toBe('Creator A')
    expect(parsed[2]?.channel).toBe('Creator C')
  })
})

describe('chat_with_persona', () => {
  let mockServer: {
    registerTool: Mock
  }
  let toolHandler: (params: { personaName: string; question: string }) => Promise<{
    content: Array<{ type: string; text: string }>
    isError?: boolean
  }>

  beforeEach(() => {
    vi.clearAllMocks()

    // Create mock server that captures the tool handler
    mockServer = {
      registerTool: vi.fn((name, config, handler) => {
        toolHandler = handler
      }),
    }

    // Mock database for persona lookup
    const mockPersonas = [
      {
        id: 1,
        name: 'Test Creator',
        channelName: 'Test Channel',
        systemPrompt: 'You are Test Creator, an expert in React.',
        expertiseTopics: ['react', 'typescript'],
        expertiseEmbedding: new Array(384).fill(0.5),
        transcriptCount: 10,
        createdAt: new Date(),
      },
    ]

    vi.mocked(db).select = vi.fn().mockReturnValue({
      from: vi.fn().mockResolvedValue(mockPersonas),
    }) as never
  })

  it('registers chat_with_persona tool with correct configuration', () => {
    registerChatWithPersona(mockServer as unknown as McpServer)

    expect(mockServer.registerTool).toHaveBeenCalledTimes(1)
    expect(mockServer.registerTool).toHaveBeenCalledWith(
      'chat_with_persona',
      expect.objectContaining({
        title: 'Chat with Persona',
        description: expect.any(String),
        inputSchema: expect.any(Object),
      }),
      expect.any(Function)
    )
  })

  it('queries persona with Agent SDK and returns response with sources', async () => {
    registerChatWithPersona(mockServer as unknown as McpServer)

    // Mock context functions
    const mockContext: SearchResult[] = [
      {
        chunkId: 1,
        videoTitle: 'React Hooks',
        content: 'React hooks are great for state management...',
        similarity: 0.9,
        startTime: 0,
        endTime: 10,
        videoId: 1,
        channel: 'Test Channel',
        youtubeId: 'abc123',
        thumbnail: null,
      },
      {
        chunkId: 2,
        videoTitle: 'TypeScript Tips',
        content: 'TypeScript provides type safety...',
        similarity: 0.8,
        startTime: 20,
        endTime: 30,
        videoId: 2,
        channel: 'Test Channel',
        youtubeId: 'def456',
        thumbnail: null,
      },
    ]
    vi.mocked(getPersonaContext).mockResolvedValue(mockContext)
    vi.mocked(formatContextForPrompt).mockReturnValue('Context from your content:\n...')

    // Mock generateText response
    vi.mocked(generateText).mockResolvedValue(
      'React hooks are indeed a powerful feature for managing state in functional components.'
    )

    const result = await toolHandler({
      personaName: 'Test Creator',
      question: 'What are your thoughts on React hooks?',
    })

    expect(generateText).toHaveBeenCalledWith(
      expect.stringContaining('You are Test Creator')
    )

    const response = JSON.parse(result.content[0]?.text ?? '{}')
    expect(response.persona).toBe('Test Creator')
    expect(response.answer).toContain('React hooks')
    expect(response.sources).toHaveLength(2)
    expect(response.sources[0]?.videoTitle).toBe('React Hooks')
  })

  it('throws error when persona not found', async () => {
    registerChatWithPersona(mockServer as unknown as McpServer)

    // Mock empty personas
    vi.mocked(db).select = vi.fn().mockReturnValue({
      from: vi.fn().mockResolvedValue([]),
    }) as never

    const result = await toolHandler({
      personaName: 'Nonexistent Persona',
      question: 'Hello?',
    })

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('Persona not found')
  })

  it('handles empty text response from Agent SDK', async () => {
    registerChatWithPersona(mockServer as unknown as McpServer)

    // Mock context
    vi.mocked(getPersonaContext).mockResolvedValue([])
    vi.mocked(formatContextForPrompt).mockReturnValue('')

    // Mock generateText with empty response
    vi.mocked(generateText).mockResolvedValue('')

    const result = await toolHandler({
      personaName: 'Test Creator',
      question: 'What are your thoughts?',
    })

    const response = JSON.parse(result.content[0]?.text ?? '{}')
    expect(response.answer).toBe('')
  })

  it('matches persona by channelName when name does not match', async () => {
    registerChatWithPersona(mockServer as unknown as McpServer)

    // Mock persona with different name and channelName
    const mockPersonas = [
      {
        id: 1,
        name: 'John Doe',
        channelName: 'Test Channel',
        systemPrompt: 'You are John Doe.',
        expertiseTopics: [],
        expertiseEmbedding: null,
        transcriptCount: 5,
        createdAt: new Date(),
      },
    ]

    vi.mocked(db).select = vi.fn().mockReturnValue({
      from: vi.fn().mockResolvedValue(mockPersonas),
    }) as never

    vi.mocked(getPersonaContext).mockResolvedValue([])
    vi.mocked(formatContextForPrompt).mockReturnValue('')

    vi.mocked(generateText).mockResolvedValue('Hello!')

    const result = await toolHandler({
      personaName: 'Test Channel',
      question: 'Hello?',
    })

    const response = JSON.parse(result.content[0]?.text ?? '{}')
    expect(response.persona).toBe('Test Channel')
    expect(response.answer).toBe('Hello!')
  })
})

describe('ensemble_query', () => {
  let mockServer: {
    registerTool: Mock
  }
  let toolHandler: (params: { question: string }) => Promise<{
    content: Array<{ type: string; text: string }>
    isError?: boolean
  }>

  beforeEach(() => {
    vi.clearAllMocks()

    mockServer = {
      registerTool: vi.fn((name, config, handler) => {
        toolHandler = handler
      }),
    }

    // Mock personas
    const mockPersonas = [
      {
        id: 1,
        name: 'Creator A',
        channelName: 'Channel A',
        systemPrompt: 'You are Creator A.',
        expertiseTopics: ['react'],
        expertiseEmbedding: new Array(384).fill(0.5),
        transcriptCount: 10,
        createdAt: new Date(),
      },
      {
        id: 2,
        name: 'Creator B',
        channelName: 'Channel B',
        systemPrompt: 'You are Creator B.',
        expertiseTopics: ['typescript'],
        expertiseEmbedding: new Array(384).fill(0.3),
        transcriptCount: 8,
        createdAt: new Date(),
      },
      {
        id: 3,
        name: 'Creator C',
        channelName: 'Channel C',
        systemPrompt: 'You are Creator C.',
        expertiseTopics: ['vue'],
        expertiseEmbedding: new Array(384).fill(0.2),
        transcriptCount: 6,
        createdAt: new Date(),
      },
    ]

    vi.mocked(db).select = vi.fn().mockReturnValue({
      from: vi.fn().mockResolvedValue(mockPersonas),
    }) as never
  })

  it('registers ensemble_query tool with correct configuration', () => {
    registerEnsembleQuery(mockServer as unknown as McpServer)

    expect(mockServer.registerTool).toHaveBeenCalledTimes(1)
    expect(mockServer.registerTool).toHaveBeenCalledWith(
      'ensemble_query',
      expect.objectContaining({
        title: 'Ensemble Query',
        description: expect.any(String),
        inputSchema: expect.any(Object),
      }),
      expect.any(Function)
    )
  })

  it('queries top 3 personas and returns responses with best match', async () => {
    registerEnsembleQuery(mockServer as unknown as McpServer)

    // Mock findBestPersonas
    const mockPersonas = [
      {
        id: 1,
        name: 'Creator A',
        channelName: 'Channel A',
        systemPrompt: 'You are Creator A.',
        expertiseTopics: ['react'],
        expertiseEmbedding: new Array(384).fill(0.5),
        transcriptCount: 10,
        regeneratingAt: null,
        lastRegeneratedAt: null,
        createdAt: new Date(),
      },
      {
        id: 2,
        name: 'Creator B',
        channelName: 'Channel B',
        systemPrompt: 'You are Creator B.',
        expertiseTopics: ['typescript'],
        expertiseEmbedding: new Array(384).fill(0.3),
        transcriptCount: 8,
        regeneratingAt: null,
        lastRegeneratedAt: null,
        createdAt: new Date(),
      },
      {
        id: 3,
        name: 'Creator C',
        channelName: 'Channel C',
        systemPrompt: 'You are Creator C.',
        expertiseTopics: ['vue'],
        expertiseEmbedding: new Array(384).fill(0.2),
        transcriptCount: 6,
        regeneratingAt: null,
        lastRegeneratedAt: null,
        createdAt: new Date(),
      },
    ]

    vi.mocked(findBestPersonas).mockResolvedValueOnce([
      { persona: mockPersonas[0]!, score: 0.9 },
    ])

    vi.mocked(findBestPersonas).mockResolvedValueOnce([
      { persona: mockPersonas[0]!, score: 0.9 },
      { persona: mockPersonas[1]!, score: 0.7 },
      { persona: mockPersonas[2]!, score: 0.5 },
    ])

    // Mock context
    const mockContext: SearchResult[] = [
      {
        chunkId: 1,
        videoTitle: 'Test Video',
        content: 'Test content...',
        similarity: 0.9,
        startTime: 0,
        endTime: 10,
        videoId: 1,
        channel: 'Channel A',
        youtubeId: 'abc123',
        thumbnail: null,
      },
    ]
    vi.mocked(getPersonaContext).mockResolvedValue(mockContext)
    vi.mocked(formatContextForPrompt).mockReturnValue('Context...')

    // Mock generateText for each persona
    vi.mocked(generateText)
      .mockResolvedValueOnce('Answer from Creator A')
      .mockResolvedValueOnce('Answer from Creator B')
      .mockResolvedValueOnce('Answer from Creator C')

    const result = await toolHandler({ question: 'What is React?' })

    expect(findBestPersonas).toHaveBeenCalledTimes(2)
    expect(generateText).toHaveBeenCalledTimes(3)

    const response = JSON.parse(result.content[0]?.text ?? '{}')
    expect(response.question).toBe('What is React?')
    expect(response.bestMatch).toMatchObject({
      persona: 'Creator A',
      score: 0.9,
    })
    expect(response.responses).toHaveLength(3)
    expect(response.responses[0]?.persona).toBe('Creator A')
    expect(response.responses[0]?.answer).toBe('Answer from Creator A')
  })

  it('returns helpful message when no personas exist', async () => {
    registerEnsembleQuery(mockServer as unknown as McpServer)

    // Mock empty personas
    vi.mocked(db).select = vi.fn().mockReturnValue({
      from: vi.fn().mockResolvedValue([]),
    }) as never

    const result = await toolHandler({ question: 'Hello?' })

    expect(result.content[0]?.text).toContain('No personas available')
    expect(result.content[0]?.text).toContain('5+ transcripts')
  })

  it('handles partial failures gracefully', async () => {
    registerEnsembleQuery(mockServer as unknown as McpServer)

    const mockPersonas = [
      {
        id: 1,
        name: 'Creator A',
        channelName: 'Channel A',
        systemPrompt: 'You are Creator A.',
        expertiseTopics: ['react'],
        expertiseEmbedding: new Array(384).fill(0.5),
        transcriptCount: 10,
        regeneratingAt: null,
        lastRegeneratedAt: null,
        createdAt: new Date(),
      },
      {
        id: 2,
        name: 'Creator B',
        channelName: 'Channel B',
        systemPrompt: 'You are Creator B.',
        expertiseTopics: ['typescript'],
        expertiseEmbedding: new Array(384).fill(0.3),
        transcriptCount: 8,
        regeneratingAt: null,
        lastRegeneratedAt: null,
        createdAt: new Date(),
      },
    ]

    vi.mocked(findBestPersonas).mockResolvedValueOnce([
      { persona: mockPersonas[0]!, score: 0.9 },
    ])

    vi.mocked(findBestPersonas).mockResolvedValueOnce([
      { persona: mockPersonas[0]!, score: 0.9 },
      { persona: mockPersonas[1]!, score: 0.7 },
    ])

    vi.mocked(getPersonaContext).mockResolvedValue([])
    vi.mocked(formatContextForPrompt).mockReturnValue('')

    // First persona succeeds, second fails
    vi.mocked(generateText)
      .mockResolvedValueOnce('Answer from Creator A')
      .mockRejectedValueOnce(new Error('API error'))

    const result = await toolHandler({ question: 'Test question?' })

    const response = JSON.parse(result.content[0]?.text ?? '{}')
    expect(response.responses).toHaveLength(1) // Only successful persona
    expect(response.responses[0]?.persona).toBe('Creator A')
  })
})

// ── queryPersona v2 guard tests ───────────────────────────────────────────────
// These verify the zero-retrieval guard fires and ask-back is absent for the
// MCP one-shot path. buildSystemParamForMcp is the shared helper from streaming.ts.

describe('queryPersona zero-retrieval guard (MCP)', () => {
  let mockServer: {
    registerTool: Mock
  }
  let toolHandler: (params: { personaName: string; question: string }) => Promise<{
    content: Array<{ type: string; text: string }>
    isError?: boolean
  }>

  beforeEach(() => {
    vi.clearAllMocks()

    mockServer = {
      registerTool: vi.fn((name, config, handler) => {
        toolHandler = handler
      }),
    }

    vi.mocked(db).select = vi.fn().mockReturnValue({
      from: vi.fn().mockResolvedValue([
        {
          id: 1,
          name: 'Test Creator',
          channelName: 'Test Channel',
          systemPrompt: 'You are Test Creator. You teach programming.',
          expertiseTopics: ['programming'],
          expertiseEmbedding: null,
          transcriptCount: 30,
          createdAt: new Date(),
        },
      ]),
    }) as never

    registerChatWithPersona(mockServer as unknown as McpServer)
  })

  it('queryPersona applies zero-retrieval guard when context is empty', async () => {
    vi.mocked(getPersonaContext).mockResolvedValue([])
    vi.mocked(formatContextForPrompt).mockReturnValue('')
    vi.mocked(generateText).mockResolvedValue('I have not covered that topic.')

    await toolHandler({ personaName: 'Test Creator', question: 'What is React?' })

    // The prompt passed to generateText must contain the zero-retrieval guard text
    const prompt = vi.mocked(generateText).mock.calls[0]?.[0] as string
    expect(prompt.toLowerCase()).toMatch(/no (content|coverage|information|transcript)/)
    expect(prompt).toMatch(/Do NOT answer from general knowledge/i)
  })

  it('queryPersona never includes ask-back text (zero-retrieval branch)', async () => {
    vi.mocked(getPersonaContext).mockResolvedValue([])
    vi.mocked(formatContextForPrompt).mockReturnValue('')
    vi.mocked(generateText).mockResolvedValue('No coverage.')

    await toolHandler({ personaName: 'Test Creator', question: 'What is React?' })

    const prompt = vi.mocked(generateText).mock.calls[0]?.[0] as string
    expect(prompt).not.toMatch(/clarif/i)
    expect(prompt).not.toMatch(/one.*question/i)
    expect(prompt).not.toMatch(/you may ask/i)
  })

  it('queryPersona never includes ask-back text (weak-retrieval branch)', async () => {
    const weakContext: SearchResult[] = [
      {
        chunkId: 1,
        content: 'Vaguely related content.',
        startTime: 10,
        endTime: 20,
        videoId: 1,
        videoTitle: 'Some Video',
        channel: 'Test Channel',
        youtubeId: 'abc123',
        thumbnail: null,
        similarity: 0.28,
      },
    ]
    vi.mocked(getPersonaContext).mockResolvedValue(weakContext)
    vi.mocked(formatContextForPrompt).mockReturnValue('[1] Some context')
    vi.mocked(generateText).mockResolvedValue('Limited answer.')

    await toolHandler({ personaName: 'Test Creator', question: 'Tell me something obscure.' })

    const prompt = vi.mocked(generateText).mock.calls[0]?.[0] as string
    // Must NOT have ask-back, even with weak retrieval
    expect(prompt).not.toMatch(/clarif/i)
    expect(prompt).not.toMatch(/one.*question/i)
    expect(prompt).not.toMatch(/you may ask/i)
  })

  it('queryPersona return shape {text, sources} unchanged', async () => {
    const richContext: SearchResult[] = [
      {
        chunkId: 1,
        content: 'TypeScript is great.',
        startTime: 10,
        endTime: 20,
        videoId: 1,
        videoTitle: 'TypeScript Basics',
        channel: 'Test Channel',
        youtubeId: 'abc123',
        thumbnail: null,
        similarity: 0.92,
      },
    ]
    vi.mocked(getPersonaContext).mockResolvedValue(richContext)
    vi.mocked(formatContextForPrompt).mockReturnValue('[1] TypeScript is great.')
    vi.mocked(generateText).mockResolvedValue('TypeScript is a typed superset of JavaScript.')

    const result = await toolHandler({ personaName: 'Test Creator', question: 'What is TypeScript?' })

    const parsed = JSON.parse(result.content[0]?.text ?? '{}')
    expect(parsed).toHaveProperty('persona')
    expect(parsed).toHaveProperty('answer')
    expect(parsed).toHaveProperty('sources')
    expect(Array.isArray(parsed.sources)).toBe(true)
    expect(parsed.answer).toBe('TypeScript is a typed superset of JavaScript.')
  })
})
