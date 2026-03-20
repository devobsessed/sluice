import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { GET } from '../route'

// Mock all dependencies
vi.mock('@/lib/automation/queries', () => ({
  getChannelsForAutoFetch: vi.fn(),
  updateChannelLastFetched: vi.fn(),
}))

vi.mock('@/lib/automation/rss', () => ({
  fetchChannelFeed: vi.fn(),
  refreshDiscoveryVideos: vi.fn(),
}))

vi.mock('@/lib/automation/delta', () => ({
  findNewVideos: vi.fn(),
  createVideoFromRSS: vi.fn(),
}))

vi.mock('workflow/api', () => ({
  start: vi.fn(),
}))

vi.mock('@/workflows/rss-feed', () => ({
  rssFeedWorkflow: vi.fn(),
}))

import { getChannelsForAutoFetch, updateChannelLastFetched } from '@/lib/automation/queries'
import { fetchChannelFeed, refreshDiscoveryVideos } from '@/lib/automation/rss'
import { findNewVideos, createVideoFromRSS } from '@/lib/automation/delta'
import { start } from 'workflow/api'
import { rssFeedWorkflow } from '@/workflows/rss-feed'
import type { RSSVideo } from '@/lib/automation/types'

describe('GET /api/cron/check-feeds', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv, CRON_SECRET: 'test-secret', ENABLE_AUTO_FETCH: 'true' }
    vi.clearAllMocks()
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('returns skipped response when ENABLE_AUTO_FETCH is not set', async () => {
    delete process.env.ENABLE_AUTO_FETCH
    const request = new Request('http://localhost/api/cron/check-feeds')

    const response = await GET(request)

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toEqual({ skipped: true, reason: 'ENABLE_AUTO_FETCH is not enabled' })
    expect(getChannelsForAutoFetch).not.toHaveBeenCalled()
  })

  it('returns skipped response when ENABLE_AUTO_FETCH is not "true"', async () => {
    process.env.ENABLE_AUTO_FETCH = 'false'
    const request = new Request('http://localhost/api/cron/check-feeds')

    const response = await GET(request)

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toEqual({ skipped: true, reason: 'ENABLE_AUTO_FETCH is not enabled' })
    expect(getChannelsForAutoFetch).not.toHaveBeenCalled()
  })

  it('proceeds normally when ENABLE_AUTO_FETCH is "true"', async () => {
    process.env.ENABLE_AUTO_FETCH = 'true'
    const request = new Request('http://localhost/api/cron/check-feeds', {
      headers: {
        authorization: 'Bearer test-secret',
      },
    })

    vi.mocked(getChannelsForAutoFetch).mockResolvedValue([])

    const response = await GET(request)

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toEqual({ checked: 0, queued: 0 })
    expect(getChannelsForAutoFetch).toHaveBeenCalledOnce()
  })

  it('returns 401 when no auth header', async () => {
    const request = new Request('http://localhost/api/cron/check-feeds')
    const response = await GET(request)

    expect(response.status).toBe(401)
    const text = await response.text()
    expect(text).toBe('Unauthorized')
  })

  it('returns 401 when auth header is wrong', async () => {
    const request = new Request('http://localhost/api/cron/check-feeds', {
      headers: {
        authorization: 'Bearer wrong-secret',
      },
    })
    const response = await GET(request)

    expect(response.status).toBe(401)
    const text = await response.text()
    expect(text).toBe('Unauthorized')
  })

  it('returns 401 when CRON_SECRET is unset', async () => {
    delete process.env.CRON_SECRET
    const request = new Request('http://localhost/api/cron/check-feeds', {
      headers: {
        authorization: 'Bearer undefined',
      },
    })
    const response = await GET(request)

    expect(response.status).toBe(401)
    const text = await response.text()
    expect(text).toBe('Unauthorized')
  })

  it('returns success with 0 queued when no channels have autoFetch', async () => {
    const request = new Request('http://localhost/api/cron/check-feeds', {
      headers: {
        authorization: 'Bearer test-secret',
      },
    })

    vi.mocked(getChannelsForAutoFetch).mockResolvedValue([])

    const response = await GET(request)

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toEqual({ checked: 0, queued: 0 })

    // Verify discovery videos cache was still refreshed (runs even with no channels)
    expect(refreshDiscoveryVideos).toHaveBeenCalledOnce()
  })

  it('processes channels and starts workflows for new videos', async () => {
    const request = new Request('http://localhost/api/cron/check-feeds', {
      headers: {
        authorization: 'Bearer test-secret',
      },
    })

    // Mock channels for auto-fetch
    vi.mocked(getChannelsForAutoFetch).mockResolvedValue([
      {
        id: 1,
        channelId: 'channel1',
        name: 'Channel 1',
        thumbnailUrl: null,
        createdAt: new Date(),
        feedUrl: null,
        autoFetch: true,
        lastFetchedAt: null,
        fetchIntervalHours: 12,
      },
      {
        id: 2,
        channelId: 'channel2',
        name: 'Channel 2',
        thumbnailUrl: null,
        createdAt: new Date(),
        feedUrl: null,
        autoFetch: true,
        lastFetchedAt: null,
        fetchIntervalHours: 12,
      },
    ])

    // Mock RSS feed results
    vi.mocked(fetchChannelFeed).mockImplementation(async (channelId) => {
      if (channelId === 'channel1') {
        return {
          channelId: 'channel1',
          channelName: 'Channel 1',
          videos: [
            {
              youtubeId: 'video1',
              title: 'Video 1',
              channelId: 'channel1',
              channelName: 'Channel 1',
              publishedAt: new Date('2024-01-01'),
              description: 'Description 1',
            },
            {
              youtubeId: 'video2',
              title: 'Video 2',
              channelId: 'channel1',
              channelName: 'Channel 1',
              publishedAt: new Date('2024-01-02'),
              description: 'Description 2',
            },
          ],
          fetchedAt: new Date(),
        }
      }
      return {
        channelId: 'channel2',
        channelName: 'Channel 2',
        videos: [
          {
            youtubeId: 'video3',
            title: 'Video 3',
            channelId: 'channel2',
            channelName: 'Channel 2',
            publishedAt: new Date('2024-01-03'),
            description: 'Description 3',
          },
        ],
        fetchedAt: new Date(),
      }
    })

    // Mock delta detection - channel1 has 1 new video, channel2 has 1 new video
    vi.mocked(findNewVideos).mockImplementation(async (rssVideos: RSSVideo[]) => {
      if (rssVideos.length === 2) {
        // channel1 - return first video as new
        return [rssVideos[0]!]
      }
      // channel2 - return all videos as new
      return rssVideos
    })

    // Mock video creation
    vi.mocked(createVideoFromRSS).mockResolvedValueOnce(101).mockResolvedValueOnce(102)

    // Mock workflow start
    vi.mocked(start).mockResolvedValue('run-id-123')

    const response = await GET(request)

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toEqual({ checked: 2, queued: 2 })

    // Verify channels were fetched
    expect(getChannelsForAutoFetch).toHaveBeenCalledTimes(1)

    // Verify RSS feeds were fetched
    expect(fetchChannelFeed).toHaveBeenCalledWith('channel1')
    expect(fetchChannelFeed).toHaveBeenCalledWith('channel2')

    // Verify videos were created
    expect(createVideoFromRSS).toHaveBeenCalledTimes(2)

    // Verify workflows were started for each new video
    expect(start).toHaveBeenCalledWith(rssFeedWorkflow, [101, 'video1'])
    expect(start).toHaveBeenCalledWith(rssFeedWorkflow, [102, 'video3'])

    // Verify lastFetchedAt was updated for both channels
    expect(updateChannelLastFetched).toHaveBeenCalledWith(1)
    expect(updateChannelLastFetched).toHaveBeenCalledWith(2)

    // Verify discovery videos cache was refreshed
    expect(refreshDiscoveryVideos).toHaveBeenCalledOnce()
  })

  it('continues processing other channels when one fails', async () => {
    const request = new Request('http://localhost/api/cron/check-feeds', {
      headers: {
        authorization: 'Bearer test-secret',
      },
    })

    vi.mocked(getChannelsForAutoFetch).mockResolvedValue([
      {
        id: 1,
        channelId: 'channel1',
        name: 'Channel 1',
        thumbnailUrl: null,
        createdAt: new Date(),
        feedUrl: null,
        autoFetch: true,
        lastFetchedAt: null,
        fetchIntervalHours: 12,
      },
      {
        id: 2,
        channelId: 'channel2',
        name: 'Channel 2',
        thumbnailUrl: null,
        createdAt: new Date(),
        feedUrl: null,
        autoFetch: true,
        lastFetchedAt: null,
        fetchIntervalHours: 12,
      },
    ])

    // Mock channel1 to fail, channel2 to succeed
    vi.mocked(fetchChannelFeed).mockImplementation(async (channelId) => {
      if (channelId === 'channel1') {
        throw new Error('Failed to fetch RSS feed')
      }
      return {
        channelId: 'channel2',
        channelName: 'Channel 2',
        videos: [
          {
            youtubeId: 'video3',
            title: 'Video 3',
            channelId: 'channel2',
            channelName: 'Channel 2',
            publishedAt: new Date('2024-01-03'),
            description: 'Description 3',
          },
        ],
        fetchedAt: new Date(),
      }
    })

    vi.mocked(findNewVideos).mockResolvedValue([
      {
        youtubeId: 'video3',
        title: 'Video 3',
        channelId: 'channel2',
        channelName: 'Channel 2',
        publishedAt: new Date('2024-01-03'),
        description: 'Description 3',
      },
    ])

    vi.mocked(createVideoFromRSS).mockResolvedValue(103)
    vi.mocked(start).mockResolvedValue('run-id-456')

    const response = await GET(request)

    expect(response.status).toBe(200)
    const data = await response.json()
    // Should still process channel2 successfully
    expect(data).toEqual({ checked: 2, queued: 1 })

    // Verify channel2 was processed
    expect(updateChannelLastFetched).toHaveBeenCalledWith(2)
    // Verify channel1 was NOT updated (it failed)
    expect(updateChannelLastFetched).not.toHaveBeenCalledWith(1)
  })

  it('still counts video as queued when workflow dispatch fails', async () => {
    const request = new Request('http://localhost/api/cron/check-feeds', {
      headers: {
        authorization: 'Bearer test-secret',
      },
    })

    vi.mocked(getChannelsForAutoFetch).mockResolvedValue([
      {
        id: 1,
        channelId: 'channel1',
        name: 'Channel 1',
        thumbnailUrl: null,
        createdAt: new Date(),
        feedUrl: null,
        autoFetch: true,
        lastFetchedAt: null,
        fetchIntervalHours: 12,
      },
    ])

    vi.mocked(fetchChannelFeed).mockResolvedValue({
      channelId: 'channel1',
      channelName: 'Channel 1',
      videos: [
        {
          youtubeId: 'video1',
          title: 'Video 1',
          channelId: 'channel1',
          channelName: 'Channel 1',
          publishedAt: new Date('2024-01-01'),
          description: 'Description 1',
        },
        {
          youtubeId: 'video2',
          title: 'Video 2',
          channelId: 'channel1',
          channelName: 'Channel 1',
          publishedAt: new Date('2024-01-02'),
          description: 'Description 2',
        },
      ],
      fetchedAt: new Date(),
    })

    vi.mocked(findNewVideos).mockResolvedValue([
      {
        youtubeId: 'video1',
        title: 'Video 1',
        channelId: 'channel1',
        channelName: 'Channel 1',
        publishedAt: new Date('2024-01-01'),
        description: 'Description 1',
      },
      {
        youtubeId: 'video2',
        title: 'Video 2',
        channelId: 'channel1',
        channelName: 'Channel 1',
        publishedAt: new Date('2024-01-02'),
        description: 'Description 2',
      },
    ])

    vi.mocked(createVideoFromRSS).mockResolvedValueOnce(201).mockResolvedValueOnce(202)

    // First workflow dispatch fails, second succeeds
    vi.mocked(start).mockRejectedValueOnce(new Error('Workflow dispatch failed'))
    vi.mocked(start).mockResolvedValueOnce('run-id-success')

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = await GET(request)

    expect(response.status).toBe(200)
    const data = await response.json()
    // Both videos should be counted as queued even though first workflow failed
    expect(data).toEqual({ checked: 1, queued: 2 })

    // Verify both videos were created
    expect(createVideoFromRSS).toHaveBeenCalledTimes(2)

    // Verify both workflow starts were attempted
    expect(start).toHaveBeenCalledTimes(2)
    expect(start).toHaveBeenCalledWith(rssFeedWorkflow, [201, 'video1'])
    expect(start).toHaveBeenCalledWith(rssFeedWorkflow, [202, 'video2'])

    // Verify error was logged for the failed dispatch
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[workflow-dispatch]'),
      expect.any(Error),
    )

    // Channel should still be marked as fetched
    expect(updateChannelLastFetched).toHaveBeenCalledWith(1)

    consoleErrorSpy.mockRestore()
  })

  it('returns 500 on critical error', async () => {
    const request = new Request('http://localhost/api/cron/check-feeds', {
      headers: {
        authorization: 'Bearer test-secret',
      },
    })

    // Mock a critical error at the top level
    vi.mocked(getChannelsForAutoFetch).mockRejectedValue(new Error('Database connection failed'))

    const response = await GET(request)

    expect(response.status).toBe(500)
    const data = await response.json()
    expect(data).toEqual({ error: 'Failed to check feeds' })
  })
})
