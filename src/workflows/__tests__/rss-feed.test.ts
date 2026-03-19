import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the processor module (fetchAndStoreTranscript is still imported directly)
vi.mock('@/lib/automation/processor', () => ({
  fetchAndStoreTranscript: vi.fn(),
}))

// Mock the shared steps module
vi.mock('@/workflows/steps', () => ({
  generateEmbeddingsStep: vi.fn(),
  generateInsightsStep: vi.fn(),
}))

// Import after mocking
import { rssFeedWorkflow } from '../rss-feed'
import { fetchAndStoreTranscript } from '@/lib/automation/processor'
import { generateEmbeddingsStep, generateInsightsStep } from '@/workflows/steps'

describe('rssFeedWorkflow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls fetchAndStoreTranscript then generateEmbeddingsStep then generateInsightsStep in sequence', async () => {
    const callOrder: string[] = []

    vi.mocked(fetchAndStoreTranscript).mockImplementation(async () => {
      callOrder.push('fetchAndStoreTranscript')
    })

    vi.mocked(generateEmbeddingsStep).mockImplementation(async () => {
      callOrder.push('generateEmbeddingsStep')
    })

    vi.mocked(generateInsightsStep).mockImplementation(async () => {
      callOrder.push('generateInsightsStep')
    })

    await rssFeedWorkflow(42, 'abc123')

    expect(fetchAndStoreTranscript).toHaveBeenCalledOnce()
    expect(fetchAndStoreTranscript).toHaveBeenCalledWith(42, 'abc123')

    expect(generateEmbeddingsStep).toHaveBeenCalledOnce()
    expect(generateEmbeddingsStep).toHaveBeenCalledWith(42)

    expect(generateInsightsStep).toHaveBeenCalledOnce()
    expect(generateInsightsStep).toHaveBeenCalledWith(42)

    // Verify three-step sequential execution order
    expect(callOrder).toEqual(['fetchAndStoreTranscript', 'generateEmbeddingsStep', 'generateInsightsStep'])
  })

  it('does not call generateEmbeddingsStep or generateInsightsStep when fetchTranscript fails', async () => {
    vi.mocked(fetchAndStoreTranscript).mockRejectedValue(
      new Error('Transcript fetch failed: No transcript available')
    )

    await expect(rssFeedWorkflow(99, 'bad-id')).rejects.toThrow(
      'Transcript fetch failed: No transcript available'
    )

    expect(fetchAndStoreTranscript).toHaveBeenCalledOnce()
    expect(generateEmbeddingsStep).not.toHaveBeenCalled()
    expect(generateInsightsStep).not.toHaveBeenCalled()
  })

  it('does not call generateInsightsStep when generateEmbeddingsStep fails', async () => {
    vi.mocked(fetchAndStoreTranscript).mockResolvedValue(undefined)
    vi.mocked(generateEmbeddingsStep).mockRejectedValue(
      new Error('Video 42 not found or has no transcript')
    )

    await expect(rssFeedWorkflow(42, 'abc123')).rejects.toThrow(
      'Video 42 not found or has no transcript'
    )

    expect(fetchAndStoreTranscript).toHaveBeenCalledOnce()
    expect(generateEmbeddingsStep).toHaveBeenCalledOnce()
    expect(generateInsightsStep).not.toHaveBeenCalled()
  })

  it('propagates errors from generateInsightsStep', async () => {
    vi.mocked(fetchAndStoreTranscript).mockResolvedValue(undefined)
    vi.mocked(generateEmbeddingsStep).mockResolvedValue(undefined)
    vi.mocked(generateInsightsStep).mockRejectedValue(
      new Error('Claude returned empty response for video 42')
    )

    await expect(rssFeedWorkflow(42, 'abc123')).rejects.toThrow(
      'Claude returned empty response for video 42'
    )

    // First two steps succeeded
    expect(fetchAndStoreTranscript).toHaveBeenCalledOnce()
    expect(generateEmbeddingsStep).toHaveBeenCalledOnce()
    // Third step was called (and failed)
    expect(generateInsightsStep).toHaveBeenCalledOnce()
  })
})
