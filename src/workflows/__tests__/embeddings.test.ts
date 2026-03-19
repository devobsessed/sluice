import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the shared steps module before importing the workflow
vi.mock('@/workflows/steps', () => ({
  generateEmbeddingsStep: vi.fn(),
  generateInsightsStep: vi.fn(),
}))

// Import after mocking
import { embeddingsWorkflow } from '../embeddings'
import { generateEmbeddingsStep, generateInsightsStep } from '@/workflows/steps'

describe('embeddingsWorkflow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls generateEmbeddingsStep then generateInsightsStep with the videoId', async () => {
    const callOrder: string[] = []

    vi.mocked(generateEmbeddingsStep).mockImplementation(async () => {
      callOrder.push('generateEmbeddingsStep')
    })

    vi.mocked(generateInsightsStep).mockImplementation(async () => {
      callOrder.push('generateInsightsStep')
    })

    await embeddingsWorkflow(42)

    expect(generateEmbeddingsStep).toHaveBeenCalledOnce()
    expect(generateEmbeddingsStep).toHaveBeenCalledWith(42)

    expect(generateInsightsStep).toHaveBeenCalledOnce()
    expect(generateInsightsStep).toHaveBeenCalledWith(42)

    // Verify sequential execution order
    expect(callOrder).toEqual(['generateEmbeddingsStep', 'generateInsightsStep'])
  })

  it('does not call generateInsightsStep when generateEmbeddingsStep fails', async () => {
    vi.mocked(generateEmbeddingsStep).mockRejectedValue(
      new Error('Video 999 not found or has no transcript')
    )

    await expect(embeddingsWorkflow(999)).rejects.toThrow(
      'Video 999 not found or has no transcript'
    )

    expect(generateInsightsStep).not.toHaveBeenCalled()
  })

  it('propagates errors from generateInsightsStep', async () => {
    vi.mocked(generateEmbeddingsStep).mockResolvedValue(undefined)
    vi.mocked(generateInsightsStep).mockRejectedValue(
      new Error('Claude returned empty response for video 42')
    )

    await expect(embeddingsWorkflow(42)).rejects.toThrow(
      'Claude returned empty response for video 42'
    )

    // Embeddings step was called (and succeeded)
    expect(generateEmbeddingsStep).toHaveBeenCalledOnce()
    // Insights step was called (and failed)
    expect(generateInsightsStep).toHaveBeenCalledOnce()
  })

  it('passes through for zero videoId edge case', async () => {
    vi.mocked(generateEmbeddingsStep).mockResolvedValue(undefined)
    vi.mocked(generateInsightsStep).mockResolvedValue(undefined)

    await embeddingsWorkflow(0)

    expect(generateEmbeddingsStep).toHaveBeenCalledWith(0)
    expect(generateInsightsStep).toHaveBeenCalledWith(0)
  })
})
