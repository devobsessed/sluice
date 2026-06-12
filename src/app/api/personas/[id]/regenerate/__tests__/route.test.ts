import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { POST } from '../route'
import { db } from '@/lib/db'
import {
  regeneratePersonaSystemPrompt,
  claimRegenerationLock,
  releaseRegenerationLock,
  waitForRegenerationToClear,
} from '@/lib/personas/service'

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
  claimRegenerationLock: vi.fn(),
  releaseRegenerationLock: vi.fn(),
  waitForRegenerationToClear: vi.fn(),
}))

const mockDb = vi.mocked(db)
const mockRegenerate = vi.mocked(regeneratePersonaSystemPrompt)
const mockClaim = vi.mocked(claimRegenerationLock)
const mockRelease = vi.mocked(releaseRegenerationLock)
const mockWait = vi.mocked(waitForRegenerationToClear)

const mockPersona = {
  id: 1,
  channelName: 'Test Channel',
  name: 'Test Creator',
  systemPrompt: 'You are Test Creator.',
  expertiseTopics: ['programming'],
  expertiseEmbedding: null,
  transcriptCount: 30,
  regeneratingAt: null,
  lastRegeneratedAt: null,
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

    // Default: lock claim succeeds (owner path)
    mockClaim.mockResolvedValue(true)
    mockRelease.mockResolvedValue(undefined)
    mockRegenerate.mockResolvedValue(updatedPersona)
    mockWait.mockResolvedValue(updatedPersona)
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

  // --- Chunk 3: lock orchestration + richer response ---

  it('response includes transcriptCount and lastRegeneratedAt on success', async () => {
    const lastRegen = new Date('2026-06-12T10:00:00Z')
    const richUpdated = {
      ...updatedPersona,
      transcriptCount: 30,
      lastRegeneratedAt: lastRegen,
    }
    mockRegenerate.mockResolvedValueOnce(richUpdated)

    const request = new Request('http://localhost/api/personas/1/regenerate', {
      method: 'POST',
    })
    const response = await POST(request, { params: Promise.resolve({ id: '1' }) })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.transcriptCount).toBe(30)
    expect(data.lastRegeneratedAt).toBeTruthy()
  })

  it('concurrent POST joins instead of regenerating: joiner gets waitForRegenerationToClear result', async () => {
    // Loser of claim: waitForRegenerationToClear is called, regenerate is NOT called
    mockClaim.mockResolvedValueOnce(false)
    const freshPersona = {
      ...updatedPersona,
      systemPrompt: 'Winner freshly regenerated prompt',
      lastRegeneratedAt: new Date(),
    }
    mockWait.mockResolvedValueOnce(freshPersona)

    const request = new Request('http://localhost/api/personas/1/regenerate', {
      method: 'POST',
    })
    const response = await POST(request, { params: Promise.resolve({ id: '1' }) })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.systemPrompt).toBe('Winner freshly regenerated prompt')
    // Regenerate must NOT have been called on the joiner path
    expect(mockRegenerate).not.toHaveBeenCalled()
    expect(mockWait).toHaveBeenCalledWith(mockPersona.id, expect.any(Number))
  })

  it('Claude failure releases the lock then returns 500', async () => {
    mockClaim.mockResolvedValueOnce(true)
    mockRegenerate.mockRejectedValueOnce(new Error('Claude API down'))

    const request = new Request('http://localhost/api/personas/1/regenerate', {
      method: 'POST',
    })
    const response = await POST(request, { params: Promise.resolve({ id: '1' }) })

    expect(response.status).toBe(500)
    // Lock must have been released even though regenerate threw
    expect(mockRelease).toHaveBeenCalledWith(mockPersona.id)
  })

  it('owner path calls claimRegenerationLock then regenerate then release', async () => {
    mockClaim.mockResolvedValueOnce(true)

    const request = new Request('http://localhost/api/personas/1/regenerate', {
      method: 'POST',
    })
    await POST(request, { params: Promise.resolve({ id: '1' }) })

    expect(mockClaim).toHaveBeenCalledWith(mockPersona.id, 300_000)
    expect(mockRegenerate).toHaveBeenCalledWith('Test Channel')
    expect(mockRelease).toHaveBeenCalledWith(mockPersona.id)
  })
})
