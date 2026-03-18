import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the processor module before importing the workflow
vi.mock('@/lib/automation/processor', () => ({
  fetchAndStoreTranscript: vi.fn(),
  processGenerateEmbeddings: vi.fn(),
}))

// Import after mocking
import { rssFeedWorkflow } from '../rss-feed'
import { fetchAndStoreTranscript, processGenerateEmbeddings } from '@/lib/automation/processor'

describe('rssFeedWorkflow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls fetchAndStoreTranscript then processGenerateEmbeddings in sequence', async () => {
    const callOrder: string[] = []

    vi.mocked(fetchAndStoreTranscript).mockImplementation(async () => {
      callOrder.push('fetchAndStoreTranscript')
    })

    vi.mocked(processGenerateEmbeddings).mockImplementation(async () => {
      callOrder.push('processGenerateEmbeddings')
    })

    await rssFeedWorkflow(42, 'abc123')

    expect(fetchAndStoreTranscript).toHaveBeenCalledOnce()
    expect(fetchAndStoreTranscript).toHaveBeenCalledWith(42, 'abc123')

    expect(processGenerateEmbeddings).toHaveBeenCalledOnce()
    expect(processGenerateEmbeddings).toHaveBeenCalledWith({ videoId: 42 })

    // Verify sequential execution order
    expect(callOrder).toEqual(['fetchAndStoreTranscript', 'processGenerateEmbeddings'])
  })

  it('does not call generateEmbeddings when fetchTranscript fails', async () => {
    vi.mocked(fetchAndStoreTranscript).mockRejectedValue(
      new Error('Transcript fetch failed: No transcript available')
    )

    await expect(rssFeedWorkflow(99, 'bad-id')).rejects.toThrow(
      'Transcript fetch failed: No transcript available'
    )

    expect(fetchAndStoreTranscript).toHaveBeenCalledOnce()
    expect(processGenerateEmbeddings).not.toHaveBeenCalled()
  })

  it('propagates errors from generateEmbeddings step', async () => {
    vi.mocked(fetchAndStoreTranscript).mockResolvedValue(undefined)
    vi.mocked(processGenerateEmbeddings).mockRejectedValue(
      new Error('Video 42 not found or has no transcript')
    )

    await expect(rssFeedWorkflow(42, 'abc123')).rejects.toThrow(
      'Video 42 not found or has no transcript'
    )

    // fetchTranscript was called (and succeeded)
    expect(fetchAndStoreTranscript).toHaveBeenCalledOnce()
    // generateEmbeddings was called (and failed)
    expect(processGenerateEmbeddings).toHaveBeenCalledOnce()
  })
})
