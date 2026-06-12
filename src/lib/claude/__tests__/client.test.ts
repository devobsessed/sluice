import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Track constructor calls
const constructorSpy = vi.fn()
const streamSpy = vi.fn()
let createImpl: (params: unknown, opts?: unknown) => Promise<unknown> = () =>
  Promise.resolve({ content: [{ type: 'text', text: 'mock response' }] })

// Track calls to messages.create across module resets
const createSpy = vi.fn()

// Mock Anthropic SDK before importing client
vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      constructor(opts: { apiKey?: string }) {
        constructorSpy(opts)
      }
      messages = {
        create: vi.fn().mockImplementation((params: unknown, opts?: unknown) => {
          createSpy(params, opts)
          return createImpl(params, opts)
        }),
        stream: (...args: unknown[]) => {
          streamSpy(...args)
          return {
            on: vi.fn().mockReturnThis(),
            finalMessage: vi.fn().mockResolvedValue({
              content: [{ type: 'text', text: 'mock response' }],
            }),
          }
        },
      }
    },
  }
})

describe('client API key trimming', () => {
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    originalEnv = { ...process.env }
    vi.resetModules()
    constructorSpy.mockClear()
    streamSpy.mockClear()
    createSpy.mockClear()
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('trims trailing newline from API key when creating Anthropic client', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key\n'

    const { generateText } = await import('../client')
    await generateText('test prompt')

    expect(constructorSpy).toHaveBeenCalledWith({ apiKey: 'sk-ant-test-key' })
  })

  it('trims spaces and newlines from AI_GATEWAY_KEY fallback', async () => {
    delete process.env.ANTHROPIC_API_KEY
    process.env.AI_GATEWAY_KEY = '  sk-ant-gateway-key  \r\n'

    const { generateText } = await import('../client')
    await generateText('test prompt')

    expect(constructorSpy).toHaveBeenCalledWith({
      apiKey: 'sk-ant-gateway-key',
      baseURL: 'https://ai-gateway.vercel.sh',
    })
  })

  it('passes clean key through unchanged (no gateway)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-clean-key'
    delete process.env.AI_GATEWAY_KEY

    const { generateText } = await import('../client')
    await generateText('test prompt')

    expect(constructorSpy).toHaveBeenCalledWith({ apiKey: 'sk-ant-clean-key' })
  })
})

describe('streamMessages', () => {
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    originalEnv = { ...process.env }
    vi.resetModules()
    constructorSpy.mockClear()
    streamSpy.mockClear()
    createSpy.mockClear()
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('production path passes native system + multi-turn messages to messages.stream', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key'

    const { streamMessages } = await import('../client')

    const system = 'You are a persona.'
    const messages = [
      { role: 'user' as const, content: 'First question' },
      { role: 'assistant' as const, content: 'First answer' },
      { role: 'user' as const, content: 'Second question' },
    ]

    streamMessages({ system, messages })

    expect(streamSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        system,
        messages,
      }),
      expect.anything(),
    )
    // Must NOT be a single concatenated user message
    const callArg = streamSpy.mock.calls[0]?.[0]
    expect(callArg.messages).toHaveLength(3)
    expect(callArg.messages[0].role).toBe('user')
    expect(callArg.messages[1].role).toBe('assistant')
  })

  it('production path passes abort signal through', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key'
    const { streamMessages } = await import('../client')

    const controller = new AbortController()
    streamMessages({
      system: 'system',
      messages: [{ role: 'user', content: 'question' }],
      signal: controller.signal,
    })

    expect(streamSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ signal: controller.signal }),
    )
  })

  it('local path serializes system+messages to a single prompt string for the agent SDK', async () => {
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.AI_GATEWAY_KEY

    // Mock the agent SDK for local path
    vi.doMock('@anthropic-ai/claude-agent-sdk', () => ({
      query: vi.fn().mockReturnValue([]),
    }))

    const { streamMessages } = await import('../client')

    const system = 'You are a persona.'
    const messages = [
      { role: 'user' as const, content: 'Question one' },
      { role: 'assistant' as const, content: 'Answer one' },
      { role: 'user' as const, content: 'Question two' },
    ]

    // Local path: should NOT call the Anthropic SDK messages.stream
    const result = streamMessages({ system, messages })

    expect(streamSpy).not.toHaveBeenCalled()
    // Returns an AgentSDKStream (has on/finalMessage)
    expect(result).toHaveProperty('on')
    expect(result).toHaveProperty('finalMessage')
  })
})

describe('generateTextFast', () => {
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    originalEnv = { ...process.env }
    vi.resetModules()
    constructorSpy.mockClear()
    createSpy.mockClear()
    createImpl = () =>
      Promise.resolve({ content: [{ type: 'text', text: 'mock response' }] })
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('returns the model text on success', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key'
    createImpl = () =>
      Promise.resolve({ content: [{ type: 'text', text: 'rewritten query' }] })

    const { generateTextFast } = await import('../client')
    const result = await generateTextFast('rewrite this follow-up')

    expect(result).toBe('rewritten query')
  })

  it('uses the gateway-prefixed Haiku model id when AI_GATEWAY_KEY is set', async () => {
    delete process.env.ANTHROPIC_API_KEY
    process.env.AI_GATEWAY_KEY = 'sk-ant-gateway-key'

    const { generateTextFast } = await import('../client')
    await generateTextFast('test prompt')

    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'anthropic/claude-haiku-4-5-20251001' }),
      expect.anything(),
    )
  })

  it('uses the raw Haiku model id when only ANTHROPIC_API_KEY is set', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key'
    delete process.env.AI_GATEWAY_KEY

    const { generateTextFast } = await import('../client')
    await generateTextFast('test prompt')

    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-haiku-4-5-20251001' }),
      expect.anything(),
    )
  })

  it('resolves null (does not throw) when the call exceeds timeoutMs', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key'

    // Never-resolving promise to simulate a hung call
    createImpl = () => new Promise(() => {})

    const { generateTextFast } = await import('../client')
    const result = await generateTextFast('test prompt', { timeoutMs: 50 })

    expect(result).toBeNull()
  })

  it('resolves null when the underlying call throws', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key'
    createImpl = () => Promise.reject(new Error('API error'))

    const { generateTextFast } = await import('../client')
    const result = await generateTextFast('test prompt')

    expect(result).toBeNull()
  })

  it('resolves null when a caller-supplied signal aborts', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key'

    const controller = new AbortController()
    // Never-resolving promise so we can control abort timing
    createImpl = () => new Promise(() => {})

    const { generateTextFast } = await import('../client')
    const resultPromise = generateTextFast('test prompt', {
      signal: controller.signal,
      timeoutMs: 5000,
    })

    // Abort immediately
    controller.abort()
    const result = await resultPromise

    expect(result).toBeNull()
  })

  it('resolves null when the model returns empty text', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key'
    createImpl = () =>
      Promise.resolve({ content: [{ type: 'text', text: '' }] })

    const { generateTextFast } = await import('../client')
    const result = await generateTextFast('test prompt')

    expect(result).toBeNull()
  })

  it('resolves null when the model returns no text block', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key'
    createImpl = () => Promise.resolve({ content: [] })

    const { generateTextFast } = await import('../client')
    const result = await generateTextFast('test prompt')

    expect(result).toBeNull()
  })

  it('does not touch generateText behavior (existing contract intact)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key'
    createImpl = () =>
      Promise.resolve({ content: [{ type: 'text', text: 'generateText result' }] })

    const { generateText } = await import('../client')
    const result = await generateText('some prompt')

    expect(result).toBe('generateText result')
  })
})
