import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the processor module before importing the workflow
vi.mock('@/lib/automation/processor', () => ({
  processGenerateEmbeddings: vi.fn(),
}))

// Import after mocking
import { embeddingsWorkflow } from '../embeddings'
import { processGenerateEmbeddings } from '@/lib/automation/processor'

describe('embeddingsWorkflow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls processGenerateEmbeddings with the videoId payload', async () => {
    vi.mocked(processGenerateEmbeddings).mockResolvedValue(undefined)

    await embeddingsWorkflow(42)

    expect(processGenerateEmbeddings).toHaveBeenCalledOnce()
    expect(processGenerateEmbeddings).toHaveBeenCalledWith({ videoId: 42 })
  })

  it('propagates errors from processGenerateEmbeddings', async () => {
    vi.mocked(processGenerateEmbeddings).mockRejectedValue(
      new Error('Video 999 not found or has no transcript')
    )

    await expect(embeddingsWorkflow(999)).rejects.toThrow(
      'Video 999 not found or has no transcript'
    )
  })

  it('passes through for zero videoId edge case', async () => {
    vi.mocked(processGenerateEmbeddings).mockResolvedValue(undefined)

    await embeddingsWorkflow(0)

    expect(processGenerateEmbeddings).toHaveBeenCalledWith({ videoId: 0 })
  })
})
