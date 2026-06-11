import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Track constructor calls
const constructorSpy = vi.fn()
const streamSpy = vi.fn()

// Mock Anthropic SDK before importing client
vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      constructor(opts: { apiKey?: string }) {
        constructorSpy(opts)
      }
      messages = {
        create: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'mock response' }],
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
