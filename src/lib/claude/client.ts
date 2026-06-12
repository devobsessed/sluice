import Anthropic from '@anthropic-ai/sdk'
import { EventEmitter } from 'events'

// Gateway requires 'anthropic/' prefix; direct SDK uses the raw model ID
const MODEL = process.env.AI_GATEWAY_KEY
  ? 'anthropic/claude-sonnet-4-20250514'
  : 'claude-sonnet-4-20250514'
const MAX_TOKENS = 4096

// Fast (Haiku) model for cheap, latency-sensitive calls.
// Same gateway-prefix rule as MODEL: prepend 'anthropic/' when routing through AI Gateway.
const FAST_MODEL = process.env.AI_GATEWAY_KEY
  ? 'anthropic/claude-haiku-4-5-20251001'
  : 'claude-haiku-4-5-20251001'
// Short output budget: rewritten queries and compressed summaries are brief.
const FAST_MAX_TOKENS = 512
// Default timeout for generateTextFast calls (milliseconds).
const FAST_DEFAULT_TIMEOUT_MS = 2000

/**
 * Dual-path Claude client.
 *
 * The agent SDK (`@anthropic-ai/claude-agent-sdk`) spawns a subprocess
 * (`node cli.js`) for every query(). This works locally because Claude Code's
 * session auth handles authentication — no API key needed. But it CANNOT work
 * on Vercel: serverless Lambdas can't spawn subprocesses reliably, and the
 * file tracer can't include cli.js.
 *
 * So:
 * - Production (Vercel): direct @anthropic-ai/sdk with AI_GATEWAY_KEY
 * - Local dev: agent SDK query() with Claude Code session auth (no API key)
 *
 * Detection: if ANTHROPIC_API_KEY or AI_GATEWAY_KEY exists → production path.
 */
function hasApiKey(): boolean {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.AI_GATEWAY_KEY)
}

// Direct SDK client (production) — lazy singleton.
let _client: Anthropic | null = null
function getClient(): Anthropic {
  if (!_client) {
    const apiKey = (process.env.ANTHROPIC_API_KEY || process.env.AI_GATEWAY_KEY || '').trim()
    _client = new Anthropic({
      apiKey,
      // Route through Vercel AI Gateway when AI_GATEWAY_KEY is set (production)
      ...(process.env.AI_GATEWAY_KEY ? { baseURL: 'https://ai-gateway.vercel.sh' } : {}),
    })
  }
  return _client
}

/**
 * Non-streaming text generation.
 *
 * Production: direct @anthropic-ai/sdk API call.
 * Local: agent SDK query() — subprocess-based, uses Claude Code session auth.
 */
export async function generateText(prompt: string): Promise<string> {
  if (hasApiKey()) {
    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages: [{ role: 'user', content: prompt }],
    })
    const textBlock = response.content.find(block => block.type === 'text')
    return textBlock?.type === 'text' ? textBlock.text : ''
  }

  // Local: agent SDK spawns subprocess with Claude Code session auth.
  // Dynamic import with webpackIgnore — production builds must not bundle
  // the agent SDK (its cli.js subprocess doesn't work on Vercel).
  const { query } = await import('@anthropic-ai/claude-agent-sdk')
  const response = query({
    prompt,
    options: {
      model: MODEL,
      maxTurns: 1,
      tools: [],
      persistSession: false,
    },
  })

  let text = ''
  for await (const event of response) {
    if (event.type === 'assistant') {
      for (const block of event.message.content) {
        if (block.type === 'text') {
          text = block.text
        }
      }
    }
  }
  return text
}

/**
 * Fast, non-streaming text generation using the Haiku model.
 *
 * General-purpose cheap call - designed as a standalone primitive with zero
 * caller-specific coupling. Callers: query rewriting (story 3), thread
 * compression (story 4).
 *
 * Enforces its own hard timeout so callers are never left hanging:
 * - Returns the text string on success.
 * - Returns null on timeout, caller-supplied abort, underlying error, or empty output.
 * - Never throws.
 *
 * The timeout resolves null via Promise.race (the guarantee), and also fires
 * an AbortSignal to attempt in-flight request cancellation (best-effort cleanup).
 *
 * Production: direct @anthropic-ai/sdk messages.create with Haiku model.
 * Local: agent SDK query() subprocess, same as generateText local path.
 */
export async function generateTextFast(
  prompt: string,
  options?: { timeoutMs?: number; signal?: AbortSignal },
): Promise<string | null> {
  const timeoutMs = options?.timeoutMs ?? FAST_DEFAULT_TIMEOUT_MS
  const callerSignal = options?.signal

  // Internal abort controller - used to cancel the in-flight request on
  // timeout or when the caller's signal fires.
  const controller = new AbortController()
  const { signal } = controller

  // Resolve null immediately if the caller's signal is already aborted.
  if (callerSignal?.aborted) {
    return null
  }

  // An "abort resolves null" promise: races against the call so that aborting
  // the internal controller (from either the timeout or the caller's signal)
  // wins the race without waiting for the SDK call to reject.
  const abortPromise = new Promise<null>(resolve => {
    signal.addEventListener('abort', () => resolve(null), { once: true })
  })

  // Chain the caller's signal: if it fires, abort our internal controller so
  // the abortPromise wins the race.
  if (callerSignal) {
    callerSignal.addEventListener('abort', () => controller.abort(), { once: true })
  }

  // A promise that resolves null after timeoutMs and fires the abort.
  let timer: ReturnType<typeof setTimeout> | null = null
  const timeoutPromise = new Promise<null>(resolve => {
    timer = setTimeout(() => {
      controller.abort()
      resolve(null)
    }, timeoutMs)
    // If the internal signal aborts before the timer fires, clear it to avoid leaking.
    signal.addEventListener('abort', () => clearTimeout(timer!), { once: true })
  })

  const callPromise = (async (): Promise<string | null> => {
    try {
      if (hasApiKey()) {
        const response = await getClient().messages.create(
          {
            model: FAST_MODEL,
            max_tokens: FAST_MAX_TOKENS,
            messages: [{ role: 'user', content: prompt }],
          },
          { signal },
        )
        const textBlock = response.content.find(block => block.type === 'text')
        const text = textBlock?.type === 'text' ? textBlock.text : ''
        return text || null
      }

      // Local: agent SDK spawns subprocess with Claude Code session auth.
      const { query } = await import('@anthropic-ai/claude-agent-sdk')
      const agentController = new AbortController()

      // Bridge our internal signal to the agent SDK's abort controller.
      signal.addEventListener('abort', () => agentController.abort(), { once: true })

      const response = query({
        prompt,
        options: {
          model: FAST_MODEL,
          maxTurns: 1,
          tools: [],
          persistSession: false,
          abortController: agentController,
        },
      })

      let text = ''
      for await (const event of response) {
        if (signal.aborted) break
        if (event.type === 'assistant') {
          for (const block of event.message.content) {
            if (block.type === 'text') {
              text = block.text
            }
          }
        }
      }
      return text || null
    } catch {
      return null
    }
  })()

  try {
    return await Promise.race([callPromise, timeoutPromise, abortPromise])
  } finally {
    // Successful completion never aborts, so the timer would otherwise stay
    // live until timeoutMs - clear it to avoid keeping request workers alive.
    if (timer) clearTimeout(timer)
  }
}

/**
 * Streaming text generation.
 *
 * Production: returns @anthropic-ai/sdk MessageStream (.on(), .finalMessage()).
 * Local: returns AgentSDKStream wrapper with the same interface.
 */
/** Shared interface for both MessageStream and AgentSDKStream. */
export interface TextStream {
  on(event: 'text', listener: (delta: string) => void): this
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: 'streamEvent', listener: (event: any) => void): this
  on(event: string, listener: (...args: unknown[]) => void): this
  finalMessage(): Promise<{ content: Array<{ type: string; text?: string }> }>
}

export function streamText(
  prompt: string,
  options?: { signal?: AbortSignal }
): TextStream {
  if (hasApiKey()) {
    return getClient().messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages: [{ role: 'user', content: prompt }],
    }, { signal: options?.signal })
  }

  // Local: agent SDK wrapper matching MessageStream interface.
  return new AgentSDKStream(prompt, options?.signal)
}

export interface MessageParam {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Messages-aware streaming variant.
 *
 * Production: calls messages.stream with native system + multi-turn messages.
 * Local: serializes system + messages into a single prompt string and delegates
 * to AgentSDKStream, because query({prompt}) is string-only.
 *
 * The existing streamText is untouched — insights and ensemble callers that
 * pass a single string continue to use it.
 */
export function streamMessages(params: {
  system: string
  messages: MessageParam[]
  signal?: AbortSignal
}): TextStream {
  const { system, messages, signal } = params

  if (hasApiKey()) {
    return getClient().messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      messages,
    }, { signal })
  }

  // Local path: the agent SDK query() takes a single string prompt.
  // Serialize system + messages into a readable conversation string.
  const serialized = serializeMessagesToPrompt(system, messages)
  return new AgentSDKStream(serialized, signal)
}

/**
 * Serializes a system prompt + message array into a single prompt string
 * for the local AgentSDK path, which is string-only.
 *
 * This is the local-dev fallback wire format only — the production model
 * always receives native system + messages.
 */
function serializeMessagesToPrompt(system: string, messages: MessageParam[]): string {
  const parts: string[] = [system]

  for (const msg of messages) {
    const label = msg.role === 'user' ? 'Human' : 'Assistant'
    parts.push(`\n\n${label}: ${msg.content}`)
  }

  return parts.join('')
}

/**
 * Wraps agent SDK query() to match the MessageStream interface.
 *
 * The agent SDK can't run on Vercel (subprocess-based), but locally it
 * provides Claude Code session auth without needing an API key.
 * This wrapper emits the same events as @anthropic-ai/sdk's MessageStream:
 * - 'text' (string delta) — used by insight-handler.ts
 * - 'streamEvent' (raw API event) — used by streaming.ts
 * - finalMessage() — used by both
 */
class AgentSDKStream extends EventEmitter {
  private _done: Promise<{ content: Array<{ type: string; text: string }> }>

  constructor(prompt: string, signal?: AbortSignal) {
    super()
    this._done = this._run(prompt, signal)
  }

  private async _run(prompt: string, signal?: AbortSignal) {
    const { query } = await import('@anthropic-ai/claude-agent-sdk')

    const abortController = new AbortController()
    if (signal) {
      signal.addEventListener('abort', () => abortController.abort(), { once: true })
    }

    const response = query({
      prompt,
      options: {
        model: MODEL,
        maxTurns: 1,
        tools: [],
        includePartialMessages: true,
        abortController,
        persistSession: false,
      },
    })

    let fullText = ''

    for await (const sdkMessage of response) {
      if (signal?.aborted) break

      if (sdkMessage.type === 'stream_event') {
        // Emit raw API event — matches MessageStream's 'streamEvent'
        this.emit('streamEvent', sdkMessage.event)

        // Emit 'text' convenience event — matches MessageStream's 'text'
        if (
          sdkMessage.event.type === 'content_block_delta'
          && sdkMessage.event.delta?.type === 'text_delta'
        ) {
          const delta = sdkMessage.event.delta.text
          this.emit('text', delta)
          fullText += delta
        }
      }

      if (sdkMessage.type === 'assistant') {
        for (const block of sdkMessage.message.content) {
          if (block.type === 'text') {
            if (!fullText) fullText = block.text
          }
        }
      }
    }

    return {
      content: fullText ? [{ type: 'text' as const, text: fullText }] : [],
    }
  }

  async finalMessage() {
    return this._done
  }
}
