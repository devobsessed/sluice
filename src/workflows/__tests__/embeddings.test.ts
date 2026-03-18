import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the processor module before importing the workflow
vi.mock('@/lib/automation/processor', () => ({
  processGenerateEmbeddings: vi.fn(),
  processGenerateInsights: vi.fn(),
}))

// Import after mocking
import { embeddingsWorkflow } from '../embeddings'
import { processGenerateEmbeddings, processGenerateInsights } from '@/lib/automation/processor'

describe('embeddingsWorkflow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls processGenerateEmbeddings then processGenerateInsights with the videoId payload', async () => {
    const callOrder: string[] = []

    vi.mocked(processGenerateEmbeddings).mockImplementation(async () => {
      callOrder.push('processGenerateEmbeddings')
    })

    vi.mocked(processGenerateInsights).mockImplementation(async () => {
      callOrder.push('processGenerateInsights')
    })

    await embeddingsWorkflow(42)

    expect(processGenerateEmbeddings).toHaveBeenCalledOnce()
    expect(processGenerateEmbeddings).toHaveBeenCalledWith({ videoId: 42 })

    expect(processGenerateInsights).toHaveBeenCalledOnce()
    expect(processGenerateInsights).toHaveBeenCalledWith({ videoId: 42 })

    // Verify sequential execution order
    expect(callOrder).toEqual(['processGenerateEmbeddings', 'processGenerateInsights'])
  })

  it('does not call processGenerateInsights when processGenerateEmbeddings fails', async () => {
    vi.mocked(processGenerateEmbeddings).mockRejectedValue(
      new Error('Video 999 not found or has no transcript')
    )

    await expect(embeddingsWorkflow(999)).rejects.toThrow(
      'Video 999 not found or has no transcript'
    )

    expect(processGenerateInsights).not.toHaveBeenCalled()
  })

  it('propagates errors from processGenerateInsights', async () => {
    vi.mocked(processGenerateEmbeddings).mockResolvedValue(undefined)
    vi.mocked(processGenerateInsights).mockRejectedValue(
      new Error('Claude returned empty response for video 42')
    )

    await expect(embeddingsWorkflow(42)).rejects.toThrow(
      'Claude returned empty response for video 42'
    )

    // Embeddings step was called (and succeeded)
    expect(processGenerateEmbeddings).toHaveBeenCalledOnce()
    // Insights step was called (and failed)
    expect(processGenerateInsights).toHaveBeenCalledOnce()
  })

  it('passes through for zero videoId edge case', async () => {
    vi.mocked(processGenerateEmbeddings).mockResolvedValue(undefined)
    vi.mocked(processGenerateInsights).mockResolvedValue(undefined)

    await embeddingsWorkflow(0)

    expect(processGenerateEmbeddings).toHaveBeenCalledWith({ videoId: 0 })
    expect(processGenerateInsights).toHaveBeenCalledWith({ videoId: 0 })
  })
})
