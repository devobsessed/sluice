import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useBatchAdd } from '../useBatchAdd'
import type { DiscoveryVideo } from '@/components/discovery/DiscoveryVideoCard'

// Mock fetch
const mockFetch = vi.fn()
global.fetch = mockFetch

describe('useBatchAdd', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const createMockVideo = (youtubeId: string): DiscoveryVideo => ({
    youtubeId,
    title: `Video ${youtubeId}`,
    channelId: 'channel1',
    channelName: 'Test Channel',
    publishedAt: '2024-01-01T00:00:00Z',
    description: 'Test description',
    inBank: false,
  })

  describe('initial state', () => {
    it('starts with empty status map and not running', () => {
      const { result } = renderHook(() => useBatchAdd({ onComplete: vi.fn() }))

      expect(result.current.batchStatus.size).toBe(0)
      expect(result.current.isRunning).toBe(false)
      expect(result.current.results).toEqual({ success: 0, failed: 0 })
    })
  })

  describe('startBatch', () => {
    it('processes a single video successfully', async () => {
      const onComplete = vi.fn()
      const video = createMockVideo('video1')

      // Mock transcript API
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, transcript: 'Test transcript' }),
      })

      // Mock video save API
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ id: 1 }),
      })

      const { result } = renderHook(() => useBatchAdd({ onComplete }))

      result.current.startBatch([video])

      // Wait for item to reach done status (set before the inter-video delay)
      await waitFor(() => {
        const item = result.current.batchStatus.get('video1')
        expect(item?.status).toBe('done')
      })

      expect(result.current.results).toEqual({ success: 1, failed: 0 })
    })

    it('processes videos serially (one at a time)', async () => {
      const onComplete = vi.fn()
      const videos = [
        createMockVideo('video1'),
        createMockVideo('video2'),
        createMockVideo('video3'),
      ]

      let video1TranscriptStarted = false
      let video2TranscriptStarted = false
      let video3TranscriptStarted = false
      let resolveVideo1Transcript: (() => void) | null = null

      // Track when each video starts; video1 blocks until explicitly resolved
      mockFetch.mockImplementation(async (url: string, options?: RequestInit) => {
        if (url.includes('/transcript')) {
          const body = JSON.parse((options?.body as string) || '{}')

          if (body.videoId === 'video1') {
            video1TranscriptStarted = true
            await new Promise<void>(resolve => { resolveVideo1Transcript = resolve })
            return {
              ok: true,
              json: async () => ({ success: true, transcript: 'Test transcript 1' }),
            }
          }

          if (body.videoId === 'video2') {
            video2TranscriptStarted = true
            return {
              ok: true,
              json: async () => ({ success: true, transcript: 'Test transcript 2' }),
            }
          }

          if (body.videoId === 'video3') {
            video3TranscriptStarted = true
            return {
              ok: true,
              json: async () => ({ success: true, transcript: 'Test transcript 3' }),
            }
          }
        }

        // Video save - instant
        return {
          ok: true,
          status: 201,
          json: async () => ({ id: 1 }),
        }
      })

      const { result } = renderHook(() => useBatchAdd({ onComplete }))

      result.current.startBatch(videos)

      // Wait for video1 to start
      await waitFor(() => {
        expect(video1TranscriptStarted).toBe(true)
      })

      // video2 and video3 must not have started yet (serial, concurrency = 1)
      expect(video2TranscriptStarted).toBe(false)
      expect(video3TranscriptStarted).toBe(false)

      // Let video1 complete — video2 will start after the 1s delay fires naturally
      resolveVideo1Transcript!()

      // Wait for video2 to start (after the 1s inter-video delay)
      await waitFor(() => {
        expect(video2TranscriptStarted).toBe(true)
      }, { timeout: 3000 })

      // Wait for video3 to start (after video2 completes + 1s delay)
      await waitFor(() => {
        expect(video3TranscriptStarted).toBe(true)
      }, { timeout: 3000 })

      // Wait for the batch to finish
      await waitFor(() => {
        expect(result.current.isRunning).toBe(false)
      }, { timeout: 3000 })

      expect(result.current.results.success).toBe(3)
    }, 10000)

    it('handles 429 rate limit with retry', async () => {
      const onComplete = vi.fn()
      const video = createMockVideo('video1')

      // First call: 429 with Retry-After
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Headers({ 'Retry-After': '1' }),
      })

      // Second call (retry): success
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, transcript: 'Test transcript' }),
      })

      // Video save
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ id: 1 }),
      })

      const { result } = renderHook(() => useBatchAdd({ onComplete }))

      result.current.startBatch([video])

      // Should eventually succeed after retry (1s Retry-After delay)
      await waitFor(() => {
        const item = result.current.batchStatus.get('video1')
        expect(item?.status).toBe('done')
      }, { timeout: 3000 })

      expect(result.current.results).toEqual({ success: 1, failed: 0 })
    }, 10000)

    it('handles 409 duplicate as success', async () => {
      const onComplete = vi.fn()
      const video = createMockVideo('video1')

      // Mock transcript API
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, transcript: 'Test transcript' }),
      })

      // Mock video save API with 409
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({ error: 'Duplicate video' }),
      })

      const { result } = renderHook(() => useBatchAdd({ onComplete }))

      result.current.startBatch([video])

      // Should mark as done despite 409
      await waitFor(() => {
        const item = result.current.batchStatus.get('video1')
        expect(item?.status).toBe('done')
      })

      expect(result.current.results).toEqual({ success: 1, failed: 0 })
    })

    it('handles transcript fetch failure', async () => {
      const onComplete = vi.fn()
      const video = createMockVideo('video1')

      // Mock transcript API failure
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ success: false, error: 'Failed to fetch transcript' }),
      })

      const { result } = renderHook(() => useBatchAdd({ onComplete }))

      result.current.startBatch([video])

      // Should mark as error
      await waitFor(() => {
        const item = result.current.batchStatus.get('video1')
        expect(item?.status).toBe('error')
        expect(item?.error).toBe('Failed to fetch transcript')
      })

      expect(result.current.results).toEqual({ success: 0, failed: 1 })
    })

    it('handles video save failure', async () => {
      const onComplete = vi.fn()
      const video = createMockVideo('video1')

      // Mock transcript API success
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, transcript: 'Test transcript' }),
      })

      // Mock video save API failure (not 409)
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Internal server error' }),
      })

      const { result } = renderHook(() => useBatchAdd({ onComplete }))

      result.current.startBatch([video])

      // Should mark as error
      await waitFor(() => {
        const item = result.current.batchStatus.get('video1')
        expect(item?.status).toBe('error')
        expect(item?.error).toBe('Internal server error')
      })

      expect(result.current.results).toEqual({ success: 0, failed: 1 })
    })

    it('calls onComplete after all items finish', async () => {
      const onComplete = vi.fn()
      const videos = [
        createMockVideo('video1'),
        createMockVideo('video2'),
      ]

      // Mock successful responses for both
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true, transcript: 'Transcript 1' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: async () => ({ id: 1 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true, transcript: 'Transcript 2' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: async () => ({ id: 2 }),
        })

      const { result } = renderHook(() => useBatchAdd({ onComplete }))

      result.current.startBatch(videos)

      // Both videos process serially; wait for both to reach done state
      await waitFor(() => {
        const item1 = result.current.batchStatus.get('video1')
        const item2 = result.current.batchStatus.get('video2')
        expect(item1?.status).toBe('done')
        expect(item2?.status).toBe('done')
      }, { timeout: 3000 })

      // After video2 completes, the final inter-video delay fires and then onComplete is called
      await waitFor(() => {
        expect(result.current.isRunning).toBe(false)
      }, { timeout: 3000 })

      expect(onComplete).toHaveBeenCalledTimes(1)
    }, 10000)

    it('calls transcript API with correct payload', async () => {
      const onComplete = vi.fn()
      const video = createMockVideo('video123')

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, transcript: 'Test transcript' }),
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ id: 1 }),
      })

      const { result } = renderHook(() => useBatchAdd({ onComplete }))

      result.current.startBatch([video])

      // Wait for item to be done — APIs are called before status reaches 'done'
      await waitFor(() => {
        const item = result.current.batchStatus.get('video123')
        expect(item?.status).toBe('done')
      })

      // Check first call was to transcript API
      const firstCall = mockFetch.mock.calls[0] as [string, RequestInit]
      expect(firstCall[0]).toBe('/api/youtube/transcript')
      expect(firstCall[1]).toMatchObject({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const body = JSON.parse(firstCall[1].body as string)
      expect(body).toEqual({ videoId: 'video123' })
    })

    it('calls video save API with correct payload', async () => {
      const onComplete = vi.fn()
      const video = createMockVideo('video123')

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, transcript: 'Test transcript' }),
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ id: 1 }),
      })

      const { result } = renderHook(() => useBatchAdd({ onComplete }))

      result.current.startBatch([video])

      // Wait for item to be done — both API calls complete before status is 'done'
      await waitFor(() => {
        const item = result.current.batchStatus.get('video123')
        expect(item?.status).toBe('done')
      })

      // Check second call was to videos API
      const secondCall = mockFetch.mock.calls[1] as [string, RequestInit]
      expect(secondCall[0]).toBe('/api/videos')
      expect(secondCall[1]).toMatchObject({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const body = JSON.parse(secondCall[1].body as string)
      expect(body).toEqual({
        youtubeId: 'video123',
        title: 'Video video123',
        channel: 'Test Channel',
        thumbnail: 'https://i.ytimg.com/vi/video123/mqdefault.jpg',
        transcript: 'Test transcript',
        sourceType: 'youtube',
      })
    })

    it('handles empty array gracefully', async () => {
      const onComplete = vi.fn()

      const { result } = renderHook(() => useBatchAdd({ onComplete }))

      result.current.startBatch([])

      // Should immediately call onComplete
      await waitFor(() => {
        expect(onComplete).toHaveBeenCalledTimes(1)
      })

      expect(result.current.isRunning).toBe(false)
      expect(result.current.results).toEqual({ success: 0, failed: 0 })
    })

    it('enforces maximum batch size limit', async () => {
      const onComplete = vi.fn()

      // Create 60 videos (over the 50 limit)
      const videos: DiscoveryVideo[] = []
      for (let i = 0; i < 60; i++) {
        videos.push(createMockVideo(`video${i}`))
      }

      // Mock successful responses for all videos
      mockFetch.mockImplementation(async () => ({
        ok: true,
        status: 201,
        json: async () => ({ success: true, transcript: 'Test', id: 1 }),
      }))

      const { result } = renderHook(() => useBatchAdd({ onComplete }))

      // Should throw error or truncate batch
      expect(() => {
        result.current.startBatch(videos)
      }).toThrow(/batch size/i)
    })

    it('processes batches up to max size successfully', async () => {
      const onComplete = vi.fn()

      // Create exactly 50 videos (at the limit)
      const videos: DiscoveryVideo[] = []
      for (let i = 0; i < 50; i++) {
        videos.push(createMockVideo(`video${i}`))
      }

      // Mock successful responses
      mockFetch.mockImplementation(async () => ({
        ok: true,
        status: 201,
        json: async () => ({ success: true, transcript: 'Test', id: 1 }),
      }))

      const { result } = renderHook(() => useBatchAdd({ onComplete }))

      // Should NOT throw for exactly 50 videos
      expect(() => {
        result.current.startBatch(videos)
      }).not.toThrow()

      // Should initialize all 50 items
      await waitFor(() => {
        expect(result.current.batchStatus.size).toBe(50)
      })
    })
  })
})
