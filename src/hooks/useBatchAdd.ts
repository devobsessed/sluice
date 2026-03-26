import { useState, useRef, useCallback } from 'react'
import type { DiscoveryVideo } from '@/components/discovery/DiscoveryVideoCard'

export type BatchItemStatus = 'pending' | 'fetching-transcript' | 'saving' | 'done' | 'error'

export interface BatchItem {
  youtubeId: string
  status: BatchItemStatus
  error?: string
}

interface UseBatchAddOptions {
  onComplete?: () => void
}

interface UseBatchAddReturn {
  startBatch: (videos: DiscoveryVideo[]) => void
  batchStatus: Map<string, BatchItem>
  isRunning: boolean
  results: { success: number; failed: number }
}

const CONCURRENCY_LIMIT = 1
const MAX_BATCH_SIZE = 50

export function useBatchAdd(options?: UseBatchAddOptions): UseBatchAddReturn {
  const { onComplete } = options || {}

  const [batchStatus, setBatchStatus] = useState<Map<string, BatchItem>>(new Map())
  const [results, setResults] = useState({ success: 0, failed: 0 })
  const [isRunning, setIsRunning] = useState(false)

  const queueRef = useRef<DiscoveryVideo[]>([])
  const activeCountRef = useRef(0)

  const updateStatus = useCallback((youtubeId: string, status: BatchItemStatus, error?: string) => {
    setBatchStatus(prev => {
      const next = new Map(prev)
      next.set(youtubeId, { youtubeId, status, error })
      return next
    })
  }, [])

  const incrementResult = useCallback((type: 'success' | 'failed') => {
    setResults(prev => ({
      ...prev,
      [type]: prev[type] + 1,
    }))
  }, [])

  const processVideo = useCallback(async (video: DiscoveryVideo) => {
    try {
      // Step 1: Fetch transcript
      updateStatus(video.youtubeId, 'fetching-transcript')

      let transcriptResponse = await fetch('/api/youtube/transcript', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId: video.youtubeId }),
      })

      // Handle 429 rate limit with retry
      if (transcriptResponse.status === 429) {
        const retryAfter = transcriptResponse.headers.get('Retry-After')
        const delaySeconds = retryAfter ? parseInt(retryAfter, 10) : 1

        // Wait and retry once
        await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000))

        transcriptResponse = await fetch('/api/youtube/transcript', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videoId: video.youtubeId }),
        })
      }

      if (!transcriptResponse.ok) {
        const errorData = await transcriptResponse.json().catch(() => ({ error: 'Failed to fetch transcript' }))
        throw new Error(errorData.error || 'Failed to fetch transcript')
      }

      const transcriptData = await transcriptResponse.json()

      if (!transcriptData.success) {
        throw new Error(transcriptData.error || 'Failed to fetch transcript')
      }

      // Step 2: Save video
      updateStatus(video.youtubeId, 'saving')

      const saveResponse = await fetch('/api/videos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          youtubeId: video.youtubeId,
          title: video.title,
          channel: video.channelName,
          thumbnail: `https://i.ytimg.com/vi/${video.youtubeId}/mqdefault.jpg`,
          transcript: transcriptData.transcript,
          sourceType: 'youtube',
        }),
      })

      // Handle 409 duplicate as success
      if (saveResponse.status === 409) {
        updateStatus(video.youtubeId, 'done')
        incrementResult('success')
        return
      }

      if (!saveResponse.ok) {
        const errorData = await saveResponse.json().catch(() => ({ error: 'Failed to save video' }))
        throw new Error(errorData.error || 'Failed to save video')
      }

      // Success
      updateStatus(video.youtubeId, 'done')
      incrementResult('success')
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      updateStatus(video.youtubeId, 'error', errorMessage)
      incrementResult('failed')
    }
  }, [updateStatus, incrementResult])

  const processNext = useCallback(async () => {
    if (queueRef.current.length === 0) {
      activeCountRef.current--

      // If no more active and queue is empty, batch is complete
      if (activeCountRef.current === 0) {
        setIsRunning(false)
        if (onComplete) {
          onComplete()
        }
      }
      return
    }

    const video = queueRef.current.shift()
    if (!video) return

    await processVideo(video)

    // Wait 1s between videos to avoid YouTube rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000))

    // Process next item in queue
    await processNext()
  }, [processVideo, onComplete])

  const startBatch = useCallback((videos: DiscoveryVideo[]) => {
    if (videos.length === 0) {
      if (onComplete) {
        onComplete()
      }
      return
    }

    // Enforce max batch size limit
    if (videos.length > MAX_BATCH_SIZE) {
      throw new Error(`Batch size (${videos.length}) exceeds maximum allowed (${MAX_BATCH_SIZE})`)
    }

    // Reset state
    setBatchStatus(new Map())
    setResults({ success: 0, failed: 0 })
    setIsRunning(true)

    // Initialize queue
    queueRef.current = [...videos]
    activeCountRef.current = 0

    // Initialize all items as pending
    const initialStatus = new Map<string, BatchItem>()
    videos.forEach(video => {
      initialStatus.set(video.youtubeId, {
        youtubeId: video.youtubeId,
        status: 'pending',
      })
    })
    setBatchStatus(initialStatus)

    // Start processing with concurrency limit
    const concurrency = Math.min(CONCURRENCY_LIMIT, videos.length)
    for (let i = 0; i < concurrency; i++) {
      activeCountRef.current++
      processNext()
    }
  }, [processNext, onComplete])

  return {
    startBatch,
    batchStatus,
    isRunning,
    results,
  }
}
