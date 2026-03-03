import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

vi.mock('@/lib/auth-guards', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth-guards')>()
  return {
    ...actual,
    requireSession: vi.fn().mockResolvedValue(null),
  }
})

import { GET } from '../route'
import { db } from '@/lib/db'

vi.mock('@/lib/db', async () => {
  const actual = await vi.importActual('@/lib/db')
  return {
    ...actual,
    db: {
      select: vi.fn(),
    },
  }
})

const mockDb = vi.mocked(db)

describe('GET /api/oauth/client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns client metadata for a known client_id', async () => {
    const mockClient = {
      name: 'Claude Code',
      icon: 'https://example.com/icon.png',
      uri: 'https://example.com',
    }

    const mockWhere = vi.fn().mockReturnThis()
    const mockLimit = vi.fn().mockResolvedValue([mockClient])
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: mockWhere,
        limit: mockLimit,
      }),
    } as never)

    mockWhere.mockReturnValue({ limit: mockLimit })

    const request = new Request('http://localhost:3001/api/oauth/client?client_id=test-client-abc')
    const response = await GET(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toEqual({
      name: 'Claude Code',
      icon: 'https://example.com/icon.png',
      uri: 'https://example.com',
    })
  })

  it('returns 400 when client_id query param is missing', async () => {
    const request = new Request('http://localhost:3001/api/oauth/client')
    const response = await GET(request)
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toHaveProperty('error')
    expect(mockDb.select).not.toHaveBeenCalled()
  })

  it('returns 400 when client_id is an empty string', async () => {
    const request = new Request('http://localhost:3001/api/oauth/client?client_id=')
    const response = await GET(request)
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toHaveProperty('error')
    expect(mockDb.select).not.toHaveBeenCalled()
  })

  it('returns 404 when client_id is unknown', async () => {
    const mockWhere = vi.fn().mockReturnThis()
    const mockLimit = vi.fn().mockResolvedValue([])
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: mockWhere,
        limit: mockLimit,
      }),
    } as never)

    mockWhere.mockReturnValue({ limit: mockLimit })

    const request = new Request('http://localhost:3001/api/oauth/client?client_id=unknown-client')
    const response = await GET(request)
    const body = await response.json()

    expect(response.status).toBe(404)
    expect(body).toEqual({ error: 'OAuth client not found' })
  })

  it('handles a client with null name, icon, and uri gracefully', async () => {
    const mockClient = {
      name: null,
      icon: null,
      uri: null,
    }

    const mockWhere = vi.fn().mockReturnThis()
    const mockLimit = vi.fn().mockResolvedValue([mockClient])
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: mockWhere,
        limit: mockLimit,
      }),
    } as never)

    mockWhere.mockReturnValue({ limit: mockLimit })

    const request = new Request('http://localhost:3001/api/oauth/client?client_id=minimal-client')
    const response = await GET(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toEqual({ name: null, icon: null, uri: null })
  })

  it('returns 500 on database error', async () => {
    const mockWhere = vi.fn().mockReturnThis()
    const mockLimit = vi.fn().mockRejectedValue(new Error('DB connection failed'))
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: mockWhere,
        limit: mockLimit,
      }),
    } as never)

    mockWhere.mockReturnValue({ limit: mockLimit })

    const request = new Request('http://localhost:3001/api/oauth/client?client_id=some-client')
    const response = await GET(request)
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({ error: 'Failed to fetch OAuth client' })
  })
})
