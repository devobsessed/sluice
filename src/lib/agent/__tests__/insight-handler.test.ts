/**
 * Tests for transport-agnostic insight handler
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { handleInsightRequest, cancelInsight, type InsightRequest, type SendFn } from '../insight-handler'

// Mock the claude client
vi.mock('@/lib/claude/client', () => ({
  streamText: vi.fn(),
}))

import { streamText } from '@/lib/claude/client'

/** Helper to create a mock stream object that mimics MessageStream */
function createMockStream(options: {
  textDeltas?: string[]
  finalContent?: string
  error?: Error
}) {
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>()

  const stream = {
    on(event: string, cb: (...args: unknown[]) => void) {
      if (!listeners.has(event)) listeners.set(event, [])
      listeners.get(event)!.push(cb)
      return stream
    },
    finalMessage: vi.fn(async () => {
      if (options.error) throw options.error

      // Emit text deltas
      if (options.textDeltas) {
        for (const delta of options.textDeltas) {
          for (const cb of listeners.get('text') ?? []) {
            cb(delta)
          }
        }
      }

      return {
        content: [{ type: 'text' as const, text: options.finalContent ?? '' }],
      }
    }),
  }

  return stream
}

describe('handleInsightRequest', () => {
  let sendMock: ReturnType<typeof vi.fn<SendFn>>
  let testRequest: InsightRequest

  beforeEach(() => {
    sendMock = vi.fn<SendFn>()
    testRequest = {
      id: 'test-id-123',
      type: 'generate_insight',
      prompt: 'Test prompt',
      systemPrompt: 'Test system prompt',
    }
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('calls send with text events during streaming', async () => {
    const mockStream = createMockStream({
      textDeltas: ['Hello ', 'world'],
      finalContent: 'Hello world',
    })

    vi.mocked(streamText).mockReturnValue(mockStream as never)

    await handleInsightRequest(sendMock, testRequest)

    // Should send text events for each delta
    expect(sendMock).toHaveBeenCalledWith({ event: 'text', content: 'Hello ' })
    expect(sendMock).toHaveBeenCalledWith({ event: 'text', content: 'world' })
    // Should send done event with full content
    expect(sendMock).toHaveBeenCalledWith({ event: 'done', fullContent: 'Hello world' })
    expect(sendMock).toHaveBeenCalledTimes(3)
  })

  it('calls send with done event on completion', async () => {
    // No streaming deltas — falls back to final message
    const mockStream = createMockStream({
      textDeltas: [],
      finalContent: 'Final result',
    })

    vi.mocked(streamText).mockReturnValue(mockStream as never)

    await handleInsightRequest(sendMock, testRequest)

    // Should send text event with full content (fallback path)
    expect(sendMock).toHaveBeenCalledWith({ event: 'text', content: 'Final result' })
    // Should send done event
    expect(sendMock).toHaveBeenCalledWith({ event: 'done', fullContent: 'Final result' })
    expect(sendMock).toHaveBeenCalledTimes(2)
  })

  it('calls send with error event on failure', async () => {
    vi.mocked(streamText).mockImplementation(() => {
      throw new Error('API failure')
    })

    await handleInsightRequest(sendMock, testRequest)

    // Should send error event
    expect(sendMock).toHaveBeenCalledWith({ event: 'error', error: 'API failure' })
    expect(sendMock).toHaveBeenCalledTimes(1)
  })

  it('handles non-Error exceptions', async () => {
    vi.mocked(streamText).mockImplementation(() => {
      throw 'String error'
    })

    await handleInsightRequest(sendMock, testRequest)

    // Should send error event with generic message
    expect(sendMock).toHaveBeenCalledWith({ event: 'error', error: 'Unknown error' })
    expect(sendMock).toHaveBeenCalledTimes(1)
  })

  it('calls send with cancelled event when aborted during streaming', async () => {
    // Create a stream that emits one delta, then waits
    const listeners = new Map<string, ((...args: unknown[]) => void)[]>()
    const pending: { resolve: ((val: unknown) => void) | null } = { resolve: null }

    const mockStream = {
      on(event: string, cb: (...args: unknown[]) => void) {
        if (!listeners.has(event)) listeners.set(event, [])
        listeners.get(event)!.push(cb)
        return mockStream
      },
      finalMessage: vi.fn(() => new Promise((resolve) => {
        // Emit first delta immediately
        for (const cb of listeners.get('text') ?? []) {
          cb('Start ')
        }
        pending.resolve = resolve
      })),
    }

    vi.mocked(streamText).mockReturnValue(mockStream as never)

    // Start the request
    const promise = handleInsightRequest(sendMock, testRequest)

    // Wait for first yield
    await new Promise((resolve) => setTimeout(resolve, 10))
    cancelInsight(testRequest.id)

    // Resolve the stream so handleInsightRequest can finish
    pending.resolve?.({ content: [{ type: 'text', text: 'Start ' }] })

    await promise

    // Should have sent text event before cancellation
    expect(sendMock).toHaveBeenCalledWith({ event: 'text', content: 'Start ' })
    // Should send cancelled event
    expect(sendMock).toHaveBeenCalledWith({ event: 'cancelled' })
  })

  it('passes combined system prompt and prompt to streamText', async () => {
    const mockStream = createMockStream({
      textDeltas: [],
      finalContent: 'Result',
    })

    vi.mocked(streamText).mockReturnValue(mockStream as never)

    await handleInsightRequest(sendMock, testRequest)

    // Verify streamText was called with combined prompt and signal
    expect(streamText).toHaveBeenCalledWith(
      'Test system prompt\n\n---\n\nTest prompt',
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    )
  })

  it('ignores empty text deltas', async () => {
    const mockStream = createMockStream({
      textDeltas: ['', 'Content'],
      finalContent: 'Content',
    })

    vi.mocked(streamText).mockReturnValue(mockStream as never)

    await handleInsightRequest(sendMock, testRequest)

    // Should skip empty delta, only send non-empty
    expect(sendMock).toHaveBeenCalledWith({ event: 'text', content: 'Content' })
    expect(sendMock).toHaveBeenCalledWith({ event: 'done', fullContent: 'Content' })
    expect(sendMock).toHaveBeenCalledTimes(2)
  })
})

describe('cancelInsight', () => {
  let sendMock: ReturnType<typeof vi.fn<SendFn>>
  let testRequest: InsightRequest

  beforeEach(() => {
    sendMock = vi.fn<SendFn>()
    testRequest = {
      id: 'cancel-test-id',
      type: 'generate_insight',
      prompt: 'Test prompt',
      systemPrompt: 'Test system prompt',
    }
    vi.clearAllMocks()
  })

  it('returns true and aborts when request exists', async () => {
    const pending: { resolve: ((val: unknown) => void) | null } = { resolve: null }
    const listeners = new Map<string, ((...args: unknown[]) => void)[]>()

    const mockStream = {
      on(event: string, cb: (...args: unknown[]) => void) {
        if (!listeners.has(event)) listeners.set(event, [])
        listeners.get(event)!.push(cb)
        return mockStream
      },
      finalMessage: vi.fn(() => new Promise((resolve) => {
        for (const cb of listeners.get('text') ?? []) {
          cb('Start')
        }
        pending.resolve = resolve
      })),
    }

    vi.mocked(streamText).mockReturnValue(mockStream as never)

    // Start the request (don't await)
    const promise = handleInsightRequest(sendMock, testRequest)

    // Wait a bit for request to start
    await new Promise((resolve) => setTimeout(resolve, 10))

    // Cancel the request
    const cancelled = cancelInsight(testRequest.id)
    expect(cancelled).toBe(true)

    // Resolve so handler can finish
    pending.resolve?.({ content: [{ type: 'text', text: 'Start' }] })

    await promise
  })

  it('returns false when request does not exist', () => {
    const cancelled = cancelInsight('non-existent-id')
    expect(cancelled).toBe(false)
  })

  it('returns false when called twice for same request', async () => {
    const mockStream = createMockStream({
      textDeltas: [],
      finalContent: 'Result',
    })

    vi.mocked(streamText).mockReturnValue(mockStream as never)

    // Start and immediately cancel
    const promise = handleInsightRequest(sendMock, testRequest)
    const firstCancel = cancelInsight(testRequest.id)
    const secondCancel = cancelInsight(testRequest.id)

    await promise

    expect(firstCancel).toBe(true)
    expect(secondCancel).toBe(false)
  })
})
