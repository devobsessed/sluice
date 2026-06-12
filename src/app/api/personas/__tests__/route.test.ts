import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { GET, POST } from '../route'
import { db } from '@/lib/db'
import { createPersona } from '@/lib/personas/service'

vi.mock('@/lib/auth-guards', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth-guards')>()
  return {
    ...actual,
    requireSession: vi.fn().mockResolvedValue(null),
  }
})

// Mock dependencies
vi.mock('@/lib/db', async () => {
  const actual = await vi.importActual('@/lib/db')
  return {
    ...actual,
    db: {
      select: vi.fn(),
    },
  }
})

vi.mock('@/lib/personas/service', () => ({
  createPersona: vi.fn(),
}))

const mockDb = vi.mocked(db)
const mockCreatePersona = vi.mocked(createPersona)

describe('GET /api/personas', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns all personas', async () => {
    const mockPersonas = [
      {
        id: 1,
        channelName: 'Test Creator 1',
        name: 'Test Creator 1',
        systemPrompt: 'You are Test Creator 1...',
        expertiseTopics: ['React', 'TypeScript'],
        expertiseEmbedding: new Array(384).fill(0.5),
        transcriptCount: 50,
        createdAt: new Date('2026-01-01'),
      },
      {
        id: 2,
        channelName: 'Test Creator 2',
        name: 'Test Creator 2',
        systemPrompt: 'You are Test Creator 2...',
        expertiseTopics: ['Python', 'Django'],
        expertiseEmbedding: new Array(384).fill(0.3),
        transcriptCount: 35,
        createdAt: new Date('2026-01-02'),
      },
    ]

    mockDb.select.mockReturnValue({
      from: vi.fn().mockResolvedValue(mockPersonas),
    } as never)

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toHaveLength(2)
    expect(data[0]).toMatchObject({
      id: 1,
      channelName: 'Test Creator 1',
      transcriptCount: 50,
    })
    expect(mockDb.select).toHaveBeenCalled()
  })

  it('returns empty array when no personas exist', async () => {
    mockDb.select.mockReturnValue({
      from: vi.fn().mockResolvedValue([]),
    } as never)

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual([])
  })

  it('returns 500 on database error', async () => {
    mockDb.select.mockReturnValue({
      from: vi.fn().mockRejectedValue(new Error('Database error')),
    } as never)

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data).toEqual({ error: 'Failed to fetch personas' })
  })
})

describe('POST /api/personas', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('creates a new persona', async () => {
    const mockPersona = {
      id: 1,
      channelName: 'Test Creator',
      name: 'Test Creator',
      systemPrompt: 'You are Test Creator...',
      expertiseTopics: ['React', 'TypeScript'],
      expertiseEmbedding: new Array(384).fill(0.5),
      transcriptCount: 50,
      regeneratingAt: null,
      lastRegeneratedAt: null,
      createdAt: new Date(),
    }

    mockCreatePersona.mockResolvedValue(mockPersona)

    const request = new Request('http://localhost:3000/api/personas', {
      method: 'POST',
      body: JSON.stringify({ channelName: 'Test Creator' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(201)
    expect(data.persona).toMatchObject({
      id: 1,
      channelName: 'Test Creator',
      transcriptCount: 50,
    })
    expect(mockCreatePersona).toHaveBeenCalledWith('Test Creator')
  })

  it('returns 400 when channelName is missing', async () => {
    const request = new Request('http://localhost:3000/api/personas', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data).toHaveProperty('error')
    expect(mockCreatePersona).not.toHaveBeenCalled()
  })

  it('returns 400 when channelName is empty string', async () => {
    const request = new Request('http://localhost:3000/api/personas', {
      method: 'POST',
      body: JSON.stringify({ channelName: '' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data).toHaveProperty('error')
  })

  it('returns 400 when body is invalid JSON', async () => {
    const request = new Request('http://localhost:3000/api/personas', {
      method: 'POST',
      body: 'invalid json',
      headers: { 'Content-Type': 'application/json' },
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data).toHaveProperty('error')
  })

  it('returns 409 when persona already exists for channel', async () => {
    const error = new Error(
      'duplicate key value violates unique constraint "personas_channel_name_unique"'
    )
    mockCreatePersona.mockRejectedValue(error)

    const request = new Request('http://localhost:3000/api/personas', {
      method: 'POST',
      body: JSON.stringify({ channelName: 'Test Creator' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(409)
    expect(data).toEqual({ error: 'Persona already exists for this channel' })
  })

  it('returns 404 when channel has no videos', async () => {
    mockCreatePersona.mockRejectedValue(new Error('No videos found for channel'))

    const request = new Request('http://localhost:3000/api/personas', {
      method: 'POST',
      body: JSON.stringify({ channelName: 'Empty Channel' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data).toEqual({ error: 'No videos found for channel' })
  })

  it('returns 500 on other errors', async () => {
    mockCreatePersona.mockRejectedValue(new Error('Unknown error'))

    const request = new Request('http://localhost:3000/api/personas', {
      method: 'POST',
      body: JSON.stringify({ channelName: 'Test Creator' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data).toEqual({ error: 'Failed to create persona' })
  })
})
