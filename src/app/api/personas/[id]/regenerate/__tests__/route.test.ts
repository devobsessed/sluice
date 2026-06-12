import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { POST } from '../route'
import { db } from '@/lib/db'
import { regeneratePersonaSystemPrompt } from '@/lib/personas/service'

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

vi.mock('@/lib/personas/service', () => ({
  regeneratePersonaSystemPrompt: vi.fn(),
}))

const mockDb = vi.mocked(db)
const mockRegenerate = vi.mocked(regeneratePersonaSystemPrompt)

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

const updatedPersona = {
  ...mockPersona,
  systemPrompt: 'You are Test Creator (v2). Voice: direct, no-nonsense.',
}

describe('POST /api/personas/[id]/regenerate', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockDb.select = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([mockPersona]),
    })

    mockRegenerate.mockResolvedValue(updatedPersona)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 401/denial when unauthenticated', async () => {
    const { requireSession } = await import('@/lib/auth-guards')
    const mockRequireSession = vi.mocked(requireSession)
    const { NextResponse } = await import('next/server')
    mockRequireSession.mockResolvedValueOnce(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )

    const request = new Request('http://localhost/api/personas/1/regenerate', {
      method: 'POST',
    })
    const response = await POST(request, { params: Promise.resolve({ id: '1' }) })

    expect(response.status).toBe(401)
    const data = await response.json()
    expect(data.error).toContain('Unauthorized')
  })

  it('returns 400 on non-numeric id', async () => {
    const request = new Request('http://localhost/api/personas/abc/regenerate', {
      method: 'POST',
    })
    const response = await POST(request, { params: Promise.resolve({ id: 'abc' }) })

    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('Invalid persona ID')
    expect(mockDb.select).not.toHaveBeenCalled()
  })

  it('returns 404 on missing persona', async () => {
    mockDb.select = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    })

    const request = new Request('http://localhost/api/personas/999/regenerate', {
      method: 'POST',
    })
    const response = await POST(request, { params: Promise.resolve({ id: '999' }) })

    expect(response.status).toBe(404)
    const data = await response.json()
    expect(data.error).toContain('Persona not found')
  })

  it('returns the updated persona on success', async () => {
    const request = new Request('http://localhost/api/personas/1/regenerate', {
      method: 'POST',
    })
    const response = await POST(request, { params: Promise.resolve({ id: '1' }) })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toMatchObject({
      id: 1,
      channelName: 'Test Channel',
      systemPrompt: updatedPersona.systemPrompt,
    })
    expect(mockRegenerate).toHaveBeenCalledWith('Test Channel')
  })

  it('calls regeneratePersonaSystemPrompt with the persona channelName', async () => {
    const request = new Request('http://localhost/api/personas/1/regenerate', {
      method: 'POST',
    })
    await POST(request, { params: Promise.resolve({ id: '1' }) })

    expect(mockRegenerate).toHaveBeenCalledWith('Test Channel')
  })

  it('returns 500 on regeneration failure', async () => {
    mockRegenerate.mockRejectedValueOnce(new Error('Claude API error'))

    const request = new Request('http://localhost/api/personas/1/regenerate', {
      method: 'POST',
    })
    const response = await POST(request, { params: Promise.resolve({ id: '1' }) })

    expect(response.status).toBe(500)
    const data = await response.json()
    expect(data.error).toBeTruthy()
  })
})
