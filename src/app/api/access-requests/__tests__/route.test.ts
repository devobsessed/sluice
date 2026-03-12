import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock db module
const mockSelect = vi.fn()
const mockInsert = vi.fn()
const mockUpdate = vi.fn()
const mockFrom = vi.fn()
const mockWhere = vi.fn()
const mockLimit = vi.fn()
const mockSet = vi.fn()
const mockValues = vi.fn()
const mockReturning = vi.fn()

// Carriers for controlling resolved values in tests
const limitResult: { value: unknown[] } = { value: [] }
const returningResult: { value: unknown[] } = { value: [{ id: 1, email: 'test@example.com' }] }

vi.mock('@/lib/db', () => ({
  db: {
    select: (...args: unknown[]) => {
      mockSelect(...args)
      return { from: (...a: unknown[]) => { mockFrom(...a); return { where: (...b: unknown[]) => { mockWhere(...b); return { limit: (...c: unknown[]) => { mockLimit(...c); return Promise.resolve(limitResult.value) } } } } } }
    },
    insert: (...args: unknown[]) => {
      mockInsert(...args)
      return { values: (...a: unknown[]) => { mockValues(...a); return { returning: (...b: unknown[]) => { mockReturning(...b); return Promise.resolve(returningResult.value) } } } }
    },
    update: (...args: unknown[]) => {
      mockUpdate(...args)
      return { set: (...a: unknown[]) => { mockSet(...a); return { where: (...b: unknown[]) => { mockWhere(...b); return Promise.resolve() } } } }
    },
  },
}))

vi.mock('@/lib/db/schema', () => ({
  accessRequests: {
    id: 'id',
    email: 'email',
    status: 'status',
  },
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => args),
}))

import { POST } from '../route'

function makeRequest(body: unknown) {
  return new Request('http://localhost:3001/api/access-requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/access-requests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: no existing request
    limitResult.value = []
    returningResult.value = [{ id: 1, email: 'user@example.com' }]
  })

  it('returns 201 with id and email on successful insert', async () => {
    const res = await POST(makeRequest({
      name: 'Test User',
      email: 'user@example.com',
    }))

    expect(res.status).toBe(201)
    const data = await res.json()
    expect(data).toEqual({ id: 1, email: 'user@example.com' })
    expect(mockInsert).toHaveBeenCalled()
  })

  it('trims and lowercases email', async () => {
    await POST(makeRequest({
      name: 'Test User',
      email: '  User@EXAMPLE.com  ',
    }))

    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'user@example.com', name: 'Test User' })
    )
  })

  it('stores message as null when not provided', async () => {
    await POST(makeRequest({
      name: 'Test User',
      email: 'user@example.com',
    }))

    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({ message: null })
    )
  })

  it('stores message when provided', async () => {
    await POST(makeRequest({
      name: 'Test User',
      email: 'user@example.com',
      message: 'I want access please',
    }))

    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'I want access please' })
    )
  })

  it('returns 400 when name is missing', async () => {
    const res = await POST(makeRequest({
      email: 'user@example.com',
    }))

    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toBe('Name is required')
  })

  it('returns 400 when email is missing', async () => {
    const res = await POST(makeRequest({
      name: 'Test User',
    }))

    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toBe('Email is required')
  })

  it('returns 400 when email is invalid', async () => {
    const res = await POST(makeRequest({
      name: 'Test User',
      email: 'not-an-email',
    }))

    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toBe('Please enter a valid email address')
  })

  it('returns 409 when email has a pending request', async () => {
    limitResult.value = [{ id: 5, status: 'pending' }]

    const res = await POST(makeRequest({
      name: 'Test User',
      email: 'user@example.com',
    }))

    expect(res.status).toBe(409)
    const data = await res.json()
    expect(data.error).toBe('A request for this email is already pending.')
  })

  it('returns 409 when email is already approved', async () => {
    limitResult.value = [{ id: 5, status: 'approved' }]

    const res = await POST(makeRequest({
      name: 'Test User',
      email: 'user@example.com',
    }))

    expect(res.status).toBe(409)
    const data = await res.json()
    expect(data.error).toBe('This email already has access. Try signing in.')
  })

  it('re-submits when email was previously denied', async () => {
    limitResult.value = [{ id: 5, status: 'denied' }]

    const res = await POST(makeRequest({
      name: 'Updated Name',
      email: 'user@example.com',
      message: 'Please reconsider',
    }))

    expect(res.status).toBe(201)
    expect(mockUpdate).toHaveBeenCalled()
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Updated Name', message: 'Please reconsider', status: 'pending' })
    )
  })
})

describe('GET /api/access-requests', () => {
  it('route module exports GET function', async () => {
    const routeModule = await import('@/app/api/access-requests/route')
    expect(typeof routeModule.GET).toBe('function')
  })
})

describe('PATCH /api/access-requests/[id]', () => {
  it('route module exports PATCH function', async () => {
    const routeModule = await import('@/app/api/access-requests/[id]/route')
    expect(typeof routeModule.PATCH).toBe('function')
  })
})
