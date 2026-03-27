import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

vi.mock('@/lib/auth-guards', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth-guards')>()
  return {
    ...actual,
    requireSession: vi.fn().mockResolvedValue(null),
  }
})

import { DELETE } from '../route'
import { db } from '@/lib/db'

// Mock dependencies
vi.mock('@/lib/db', async () => {
  const actual = await vi.importActual('@/lib/db')
  return {
    ...actual,
    db: {
      delete: vi.fn(),
      transaction: vi.fn(),
      select: vi.fn(),
    },
  }
})

const mockDb = vi.mocked(db)

const mockChannel = {
  id: 1,
  channelId: 'UCtest123',
  name: 'Test Channel',
  thumbnailUrl: null,
  createdAt: new Date(),
  feedUrl: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCtest123',
  autoFetch: false,
  lastFetchedAt: null,
  fetchIntervalHours: 12,
}

describe('DELETE /api/channels/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('successfully deletes an existing channel and its discovery_videos', async () => {
    // Select to fetch channel row
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([mockChannel]),
      }),
    } as never)

    // Transaction mock: callback receives tx with delete method
    mockDb.transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
      const txDelete = vi.fn()
        .mockReturnValueOnce({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([mockChannel]),
          }),
        })
        .mockReturnValueOnce({
          where: vi.fn().mockResolvedValue(undefined),
        })
      return cb({ delete: txDelete })
    })

    const response = await DELETE(
      new Request('http://localhost/api/channels/1'),
      { params: Promise.resolve({ id: '1' }) }
    )

    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.channel).toBeDefined()
    expect(data.channel.channelId).toBe('UCtest123')
    expect(mockDb.transaction).toHaveBeenCalledTimes(1)
  })

  it('cleans up discovery_videos using the YouTube channelId, not the database row id', async () => {
    const channelWithDifferentIds = {
      ...mockChannel,
      id: 42,
      channelId: 'UCyoutube_channel_id',
    }

    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([channelWithDifferentIds]),
      }),
    } as never)

    const discoveryDeleteWhereFn = vi.fn().mockResolvedValue(undefined)

    mockDb.transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
      const txDelete = vi.fn()
        .mockReturnValueOnce({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([channelWithDifferentIds]),
          }),
        })
        .mockReturnValueOnce({
          where: discoveryDeleteWhereFn,
        })
      return cb({ delete: txDelete })
    })

    await DELETE(
      new Request('http://localhost/api/channels/42'),
      { params: Promise.resolve({ id: '42' }) }
    )

    expect(mockDb.transaction).toHaveBeenCalledTimes(1)
    expect(discoveryDeleteWhereFn).toHaveBeenCalledTimes(1)
  })

  it('returns the deleted channel data', async () => {
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([mockChannel]),
      }),
    } as never)

    mockDb.transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
      const txDelete = vi.fn()
        .mockReturnValueOnce({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([mockChannel]),
          }),
        })
        .mockReturnValueOnce({
          where: vi.fn().mockResolvedValue(undefined),
        })
      return cb({ delete: txDelete })
    })

    const response = await DELETE(
      new Request('http://localhost/api/channels/1'),
      { params: Promise.resolve({ id: '1' }) }
    )

    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.channel.id).toBe(1)
    expect(data.channel.name).toBe('Test Channel')
    expect(data.channel.channelId).toBe('UCtest123')
  })

  it('returns 404 when channel not found', async () => {
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    } as never)

    const response = await DELETE(
      new Request('http://localhost/api/channels/999'),
      { params: Promise.resolve({ id: '999' }) }
    )

    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data).toEqual({ error: 'Channel not found' })
    // Should not attempt any deletes if channel doesn't exist
    expect(mockDb.delete).not.toHaveBeenCalled()
  })

  it('returns 400 for invalid channel ID format', async () => {
    const response = await DELETE(
      new Request('http://localhost/api/channels/invalid'),
      { params: Promise.resolve({ id: 'invalid' }) }
    )

    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data).toHaveProperty('error')
  })

  it('returns 400 for negative channel ID', async () => {
    const response = await DELETE(
      new Request('http://localhost/api/channels/-1'),
      { params: Promise.resolve({ id: '-1' }) }
    )

    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data).toHaveProperty('error')
  })

  it('returns 400 for zero channel ID', async () => {
    const response = await DELETE(
      new Request('http://localhost/api/channels/0'),
      { params: Promise.resolve({ id: '0' }) }
    )

    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data).toHaveProperty('error')
  })

  it('returns 500 on database error', async () => {
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockRejectedValue(new Error('Database error')),
      }),
    } as never)

    const response = await DELETE(
      new Request('http://localhost/api/channels/1'),
      { params: Promise.resolve({ id: '1' }) }
    )

    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data).toEqual({ error: 'Failed to unfollow channel' })
  })
})
