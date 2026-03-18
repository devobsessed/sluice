import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the processor module before importing the workflow
vi.mock('@/lib/automation/processor', () => ({
  fetchAndStoreTranscript: vi.fn(),
  processGenerateEmbeddings: vi.fn(),
  processGenerateInsights: vi.fn(),
}))

// Import after mocking
import { rssFeedWorkflow } from '../rss-feed'
import { fetchAndStoreTranscript, processGenerateEmbeddings, processGenerateInsights } from '@/lib/automation/processor'

describe('rssFeedWorkflow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls fetchAndStoreTranscript then processGenerateEmbeddings then processGenerateInsights in sequence', async () => {
    const callOrder: string[] = []

    vi.mocked(fetchAndStoreTranscript).mockImplementation(async () => {
      callOrder.push('fetchAndStoreTranscript')
    })

    vi.mocked(processGenerateEmbeddings).mockImplementation(async () => {
      callOrder.push('processGenerateEmbeddings')
    })

    vi.mocked(processGenerateInsights).mockImplementation(async () => {
      callOrder.push('processGenerateInsights')
    })

    await rssFeedWorkflow(42, 'abc123')

    expect(fetchAndStoreTranscript).toHaveBeenCalledOnce()
    expect(fetchAndStoreTranscript).toHaveBeenCalledWith(42, 'abc123')

    expect(processGenerateEmbeddings).toHaveBeenCalledOnce()
    expect(processGenerateEmbeddings).toHaveBeenCalledWith({ videoId: 42 })

    expect(processGenerateInsights).toHaveBeenCalledOnce()
    expect(processGenerateInsights).toHaveBeenCalledWith({ videoId: 42 })

    // Verify three-step sequential execution order
    expect(callOrder).toEqual(['fetchAndStoreTranscript', 'processGenerateEmbeddings', 'processGenerateInsights'])
  })

  it('does not call generateEmbeddings or generateInsights when fetchTranscript fails', async () => {
    vi.mocked(fetchAndStoreTranscript).mockRejectedValue(
      new Error('Transcript fetch failed: No transcript available')
    )

    await expect(rssFeedWorkflow(99, 'bad-id')).rejects.toThrow(
      'Transcript fetch failed: No transcript available'
    )

    expect(fetchAndStoreTranscript).toHaveBeenCalledOnce()
    expect(processGenerateEmbeddings).not.toHaveBeenCalled()
    expect(processGenerateInsights).not.toHaveBeenCalled()
  })

  it('does not call generateInsights when generateEmbeddings fails', async () => {
    vi.mocked(fetchAndStoreTranscript).mockResolvedValue(undefined)
    vi.mocked(processGenerateEmbeddings).mockRejectedValue(
      new Error('Video 42 not found or has no transcript')
    )

    await expect(rssFeedWorkflow(42, 'abc123')).rejects.toThrow(
      'Video 42 not found or has no transcript'
    )

    expect(fetchAndStoreTranscript).toHaveBeenCalledOnce()
    expect(processGenerateEmbeddings).toHaveBeenCalledOnce()
    expect(processGenerateInsights).not.toHaveBeenCalled()
  })

  it('propagates errors from generateInsights step', async () => {
    vi.mocked(fetchAndStoreTranscript).mockResolvedValue(undefined)
    vi.mocked(processGenerateEmbeddings).mockResolvedValue(undefined)
    vi.mocked(processGenerateInsights).mockRejectedValue(
      new Error('Claude returned empty response for video 42')
    )

    await expect(rssFeedWorkflow(42, 'abc123')).rejects.toThrow(
      'Claude returned empty response for video 42'
    )

    // First two steps succeeded
    expect(fetchAndStoreTranscript).toHaveBeenCalledOnce()
    expect(processGenerateEmbeddings).toHaveBeenCalledOnce()
    // Third step was called (and failed)
    expect(processGenerateInsights).toHaveBeenCalledOnce()
  })
})
