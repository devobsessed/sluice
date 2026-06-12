import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { HistoryItem } from '@/lib/personas/chat-storage'

// Mock generateTextFast before importing the module under test
vi.mock('@/lib/claude/client', () => ({
  generateTextFast: vi.fn(),
}))

import { generateTextFast } from '@/lib/claude/client'
import { detectFollowUp, rewriteFollowUpQuery } from '../query-rewrite'

const mockGenerateTextFast = vi.mocked(generateTextFast)

// ── Fixtures ──────────────────────────────────────────────────────────────────

const oneExchange: HistoryItem[] = [
  { question: 'What is React?', answer: 'React is a JavaScript library for building UIs.' },
]

const twoExchanges: HistoryItem[] = [
  { question: 'What is React?', answer: 'React is a JavaScript library for building UIs.' },
  { question: 'How do hooks work?', answer: 'Hooks let you use state in function components.' },
]

const threeExchanges: HistoryItem[] = [
  { question: 'What is TypeScript?', answer: 'TypeScript adds types to JavaScript.' },
  { question: 'What is React?', answer: 'React is a JavaScript library for building UIs.' },
  { question: 'How do hooks work?', answer: 'Hooks let you use state in function components.' },
]

// ── detectFollowUp ────────────────────────────────────────────────────────────

describe('detectFollowUp', () => {
  it('returns false for empty history (first question)', () => {
    expect(detectFollowUp('What is React?', [])).toBe(false)
  })

  it('returns false for empty history even on an ambiguous question', () => {
    // "expand on that" with NO history is still not a follow-up - first question
    expect(detectFollowUp('expand on that', [])).toBe(false)
  })

  it('returns true for "that" deixis marker with non-empty history', () => {
    expect(detectFollowUp('expand on that', oneExchange)).toBe(true)
  })

  it('returns true for "the second one" with non-empty history', () => {
    expect(detectFollowUp('tell me more about the second one', oneExchange)).toBe(true)
  })

  it('returns true for "you mentioned" with non-empty history', () => {
    expect(detectFollowUp('what about the thing you mentioned earlier?', oneExchange)).toBe(true)
  })

  it('returns true for "it" with non-empty history', () => {
    expect(detectFollowUp('can you explain it further?', oneExchange)).toBe(true)
  })

  it('returns true for "this" with non-empty history', () => {
    expect(detectFollowUp('how does this work?', oneExchange)).toBe(true)
  })

  it('returns true for a very short question with history', () => {
    // e.g. "why?" or "really?" - too short to be standalone
    expect(detectFollowUp('why?', oneExchange)).toBe(true)
  })

  it('returns true for a short question like "and then?" with history', () => {
    expect(detectFollowUp('and then?', oneExchange)).toBe(true)
  })

  it('returns false for a clearly standalone question even with non-empty history (conservative bias)', () => {
    // Long, self-contained question - no markers, not short
    expect(
      detectFollowUp(
        'What are the performance implications of using React context vs Zustand for global state management?',
        oneExchange,
      ),
    ).toBe(false)
  })

  it('returns false for another standalone question with history (no markers)', () => {
    expect(
      detectFollowUp(
        'How do I configure TypeScript strict mode in a Next.js project?',
        twoExchanges,
      ),
    ).toBe(false)
  })

  it('returns true for leading "but" with history', () => {
    expect(detectFollowUp('but what about performance?', oneExchange)).toBe(true)
  })

  it('returns true for "those" marker with history', () => {
    expect(detectFollowUp('can you list those again?', oneExchange)).toBe(true)
  })

  it('returns true for "earlier" marker with history', () => {
    expect(detectFollowUp('you said earlier that it was fast, is that true?', oneExchange)).toBe(true)
  })

  it('is case-insensitive for marker matching', () => {
    expect(detectFollowUp('Can you expand on THAT?', oneExchange)).toBe(true)
  })
})

// ── rewriteFollowUpQuery ──────────────────────────────────────────────────────

describe('rewriteFollowUpQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns the Haiku rewrite when the heuristic fires and the call succeeds', async () => {
    mockGenerateTextFast.mockResolvedValue('React hook performance optimization techniques')

    const result = await rewriteFollowUpQuery({
      question: 'expand on that',
      history: oneExchange,
    })

    expect(result).toBe('React hook performance optimization techniques')
  })

  it('uses only the last 2 exchanges as context (assert generateTextFast prompt excludes older history)', async () => {
    mockGenerateTextFast.mockResolvedValue('React hooks standalone query')

    await rewriteFollowUpQuery({
      question: 'expand on that',
      history: threeExchanges, // 3 exchanges - only last 2 should appear in prompt
    })

    expect(mockGenerateTextFast).toHaveBeenCalledOnce()
    const promptArg = mockGenerateTextFast.mock.calls[0]![0] as string

    // Last 2 exchanges should be in the prompt
    expect(promptArg).toContain('What is React?')
    expect(promptArg).toContain('How do hooks work?')

    // First exchange (TypeScript) must NOT appear
    expect(promptArg).not.toContain('What is TypeScript?')
    expect(promptArg).not.toContain('TypeScript adds types')
  })

  it('returns the original question when the heuristic does not fire (generateTextFast not called)', async () => {
    const standalone =
      'What are the performance implications of using React context vs Zustand for global state management?'

    const result = await rewriteFollowUpQuery({
      question: standalone,
      history: oneExchange,
    })

    expect(result).toBe(standalone)
    expect(mockGenerateTextFast).not.toHaveBeenCalled()
  })

  it('returns the original question when generateTextFast resolves null (timeout/error fallback)', async () => {
    mockGenerateTextFast.mockResolvedValue(null)

    const question = 'expand on that'
    const result = await rewriteFollowUpQuery({ question, history: oneExchange })

    expect(result).toBe(question)
  })

  it('returns the original question when the rewrite is empty', async () => {
    mockGenerateTextFast.mockResolvedValue('')

    const question = 'expand on that'
    const result = await rewriteFollowUpQuery({ question, history: oneExchange })

    expect(result).toBe(question)
  })

  it('returns the original question when the rewrite is whitespace-only', async () => {
    mockGenerateTextFast.mockResolvedValue('   \n  ')

    const question = 'expand on that'
    const result = await rewriteFollowUpQuery({ question, history: oneExchange })

    expect(result).toBe(question)
  })

  it('does not invoke generateTextFast when history is empty (first question)', async () => {
    const question = 'What is React?'
    const result = await rewriteFollowUpQuery({ question, history: [] })

    expect(result).toBe(question)
    expect(mockGenerateTextFast).not.toHaveBeenCalled()
  })

  it('trims whitespace from the rewrite before returning', async () => {
    mockGenerateTextFast.mockResolvedValue('  React hooks performance  ')

    const result = await rewriteFollowUpQuery({
      question: 'expand on that',
      history: oneExchange,
    })

    expect(result).toBe('React hooks performance')
  })

  it('passes the caller signal to generateTextFast', async () => {
    mockGenerateTextFast.mockResolvedValue('rewritten query')
    const controller = new AbortController()

    await rewriteFollowUpQuery({
      question: 'expand on that',
      history: oneExchange,
      signal: controller.signal,
    })

    expect(mockGenerateTextFast).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: controller.signal }),
    )
  })

  it('uses exactly 2 context exchanges even when only 1 is available', async () => {
    mockGenerateTextFast.mockResolvedValue('standalone query')

    await rewriteFollowUpQuery({
      question: 'expand on that',
      history: oneExchange, // only 1 exchange available
    })

    const promptArg = mockGenerateTextFast.mock.calls[0]![0] as string
    expect(promptArg).toContain('What is React?')
    expect(promptArg).toContain('React is a JavaScript library')
  })
})
