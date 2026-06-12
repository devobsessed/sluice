import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { POST } from '../route'
import { db } from '@/lib/db'
import { distillFacts } from '@/lib/personas/thread-compression'

vi.mock('@/lib/auth-guards', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth-guards')>()
  return {
    ...actual,
    requireSession: vi.fn().mockResolvedValue(null),
  }
})

vi.mock('@/lib/db', async () => {
  const actual = await vi.importActual('@/lib/db')
  return {
    ...actual,
    db: {
      select: vi.fn(),
    },
  }
})

vi.mock('@/lib/personas/thread-compression', () => ({
  distillFacts: vi.fn(),
}))

const mockDb = vi.mocked(db)
const mockDistill = vi.mocked(distillFacts)

const mockPersona = {
  id: 1,
  channelName: 'Test Channel',
  name: 'Test Creator',
  systemPrompt: 'You are Test Creator.',
  expertiseTopics: ['programming'],
  expertiseEmbedding: null,
  transcriptCount: 30,
  createdAt: new Date(),
}

function buildRequest(
  id: string,
  body: unknown
): { request: Request; context: { params: Promise<{ id: string }> } } {
  return {
    request: new Request(`http://localhost/api/personas/${id}/compress-thread`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    context: { params: Promise.resolve({ id }) },
  }
}

const validBody = {
  thread: [{ question: 'What ORM do you like?', answer: 'Drizzle, every time.' }],
  existingFacts: ['building a serverless app'],
}

describe('POST /api/personas/[id]/compress-thread', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockDb.select = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([mockPersona]),
    })

    mockDistill.mockResolvedValue(['prefers Drizzle', 'building a serverless app'])
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 401/denial when unauthenticated', async () => {
    const { requireSession } = await import('@/lib/auth-guards')
    const { NextResponse } = await import('next/server')
    vi.mocked(requireSession).mockResolvedValueOnce(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )

    const { request, context } = buildRequest('1', validBody)
    const response = await POST(request, context)

    expect(response.status).toBe(401)
  })

  it('returns 400 on non-numeric id', async () => {
    const { request, context } = buildRequest('abc', validBody)
    const response = await POST(request, context)

    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('Invalid persona ID')
    expect(mockDb.select).not.toHaveBeenCalled()
  })

  it('returns 400 on invalid JSON body', async () => {
    const request = new Request('http://localhost/api/personas/1/compress-thread', {
      method: 'POST',
      body: 'not-json',
    })
    const response = await POST(request, { params: Promise.resolve({ id: '1' }) })

    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('Invalid JSON')
  })

  it('rejects existingFacts over the cap of 5', async () => {
    const { request, context } = buildRequest('1', {
      ...validBody,
      existingFacts: ['a', 'b', 'c', 'd', 'e', 'f'],
    })
    const response = await POST(request, context)

    expect(response.status).toBe(400)
    expect(mockDistill).not.toHaveBeenCalled()
  })

  it('rejects a thread over the bound of 50 exchanges', async () => {
    const { request, context } = buildRequest('1', {
      ...validBody,
      thread: Array.from({ length: 51 }, (_, i) => ({
        question: `q${i}`,
        answer: `a${i}`,
      })),
    })
    const response = await POST(request, context)

    expect(response.status).toBe(400)
    expect(mockDistill).not.toHaveBeenCalled()
  })

  it('returns 404 on missing persona', async () => {
    mockDb.select = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    })

    const { request, context } = buildRequest('999', validBody)
    const response = await POST(request, context)

    expect(response.status).toBe(404)
    expect((await response.json()).error).toContain('Persona not found')
  })

  it('runs distillFacts with the persona channelName and returns facts', async () => {
    const { request, context } = buildRequest('1', validBody)
    const response = await POST(request, context)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      facts: ['prefers Drizzle', 'building a serverless app'],
    })
    expect(mockDistill).toHaveBeenCalledWith(
      expect.objectContaining({
        thread: validBody.thread,
        existingFacts: validBody.existingFacts,
        channelName: 'Test Channel',
      })
    )
  })

  it('returns existingFacts unchanged when distillation fails (stateless failure passthrough)', async () => {
    mockDistill.mockResolvedValueOnce(validBody.existingFacts)

    const { request, context } = buildRequest('1', validBody)
    const response = await POST(request, context)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ facts: validBody.existingFacts })
  })

  it('returns 500 when distillFacts throws', async () => {
    mockDistill.mockRejectedValueOnce(new Error('boom'))

    const { request, context } = buildRequest('1', validBody)
    const response = await POST(request, context)

    expect(response.status).toBe(500)
  })
})
