import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { HistoryItem } from '@/lib/personas/chat-storage'

// Mock generateTextFast before importing the module under test
vi.mock('@/lib/claude/client', () => ({
  generateTextFast: vi.fn(),
}))

import { generateTextFast } from '@/lib/claude/client'
import { distillFacts } from '../thread-compression'

const mockGenerateTextFast = vi.mocked(generateTextFast)

// ── Fixtures ──────────────────────────────────────────────────────────────────

const pythonThread: HistoryItem[] = [
  { question: 'What Python libraries do you recommend?', answer: 'For data science, pandas and numpy are excellent choices.' },
  { question: 'Any Python web frameworks?', answer: 'Flask and FastAPI are both excellent choices.' },
]

const typescriptThread: HistoryItem[] = [
  { question: 'How do TypeScript generics work?', answer: 'Generics let you write type-safe reusable code.' },
  { question: 'What about advanced TypeScript patterns?', answer: 'Conditional types and mapped types are powerful tools.' },
]

const drizzleThread: HistoryItem[] = [
  { question: 'Do you prefer Drizzle or Prisma?', answer: 'Drizzle is great for type safety close to SQL.' },
  { question: 'How do you handle migrations?', answer: 'With drizzle-kit push for schema syncing.' },
]

// ── FIRST TEST: adversarial contradictory-thread coherence ────────────────────

describe('distillFacts - FIRST: contradictory threads yield a coherent fact set', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reconciles contradictory facts - newer thread wins, no contradiction pair survives', async () => {
    // existingFacts: user prefers Python (from an older thread)
    // incoming thread: user is interested in TypeScript
    // The model returns a reconciled set where the contradiction is resolved
    const existingFacts = ['prefers Python for scripting']
    const reconciledResponse = [
      'exploring advanced TypeScript patterns',
      'interested in type-safe database ORMs',
      'building with Next.js App Router',
    ].join('\n')

    mockGenerateTextFast.mockResolvedValue(reconciledResponse)

    const result = await distillFacts({
      thread: typescriptThread,
      existingFacts,
      channelName: 'ThePrimeagen',
    })

    // No contradictory pair should survive: both "prefers Python" and a TS fact cannot coexist
    const hasPythonPreference = result.some(
      (f) => f.toLowerCase().includes('python') && f.toLowerCase().includes('prefer')
    )
    const hasTypescriptFact = result.some(
      (f) => f.toLowerCase().includes('typescript')
    )

    // The newer thread (TypeScript) should win; Python preference should not survive alongside it
    expect(hasTypescriptFact).toBe(true)
    expect(hasPythonPreference).toBe(false)
    expect(result.length).toBeGreaterThan(0)
    expect(result.length).toBeLessThanOrEqual(5)
  })

  it('does not allow both contradictory facts when model reconciles properly', async () => {
    // Simulate a model that correctly resolves the contradiction
    mockGenerateTextFast.mockResolvedValue(
      '- exploring advanced TypeScript patterns\n- prefers Drizzle ORM for type safety'
    )

    const result = await distillFacts({
      thread: typescriptThread,
      existingFacts: ['prefers Python for scripting', 'uses Flask for web apps'],
      channelName: 'ThePrimeagen',
    })

    // The reconciled set should not contain Python preference alongside TypeScript preference
    const hasPythonPreference = result.some(
      (f) => f.toLowerCase().includes('python') && f.toLowerCase().includes('prefer')
    )
    expect(hasPythonPreference).toBe(false)
    expect(result.length).toBeLessThanOrEqual(5)
  })
})

// ── Failure path ──────────────────────────────────────────────────────────────

describe('distillFacts - failure path', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns existingFacts unchanged when generateTextFast returns null', async () => {
    mockGenerateTextFast.mockResolvedValue(null)

    const existingFacts = ['self-hosted Postgres on a VPS', 'prefers Drizzle']
    const result = await distillFacts({
      thread: drizzleThread,
      existingFacts,
      channelName: 'ThePrimeagen',
    })

    expect(result).toEqual(existingFacts)
    expect(result).toBe(existingFacts) // exact same reference - no copy
  })

  it('returns existingFacts unchanged when parse yields no statements', async () => {
    // Model returns empty string
    mockGenerateTextFast.mockResolvedValue('   \n\n   ')

    const existingFacts = ['self-hosted Postgres on a VPS']
    const result = await distillFacts({
      thread: drizzleThread,
      existingFacts,
      channelName: 'ThePrimeagen',
    })

    expect(result).toEqual(existingFacts)
  })

  it('returns empty array (not existingFacts) when existing is empty and parse yields nothing', async () => {
    mockGenerateTextFast.mockResolvedValue(null)

    const result = await distillFacts({
      thread: drizzleThread,
      existingFacts: [],
      channelName: 'ThePrimeagen',
    })

    expect(result).toEqual([])
  })
})

// ── Parsing ───────────────────────────────────────────────────────────────────

describe('distillFacts - parsing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('parses bulleted model output into clean statements', async () => {
    const bulletedResponse =
      '- self-hosted Postgres on a VPS\n- prefers Drizzle ORM\n- using Next.js App Router'

    mockGenerateTextFast.mockResolvedValue(bulletedResponse)

    const result = await distillFacts({
      thread: drizzleThread,
      existingFacts: [],
      channelName: 'ThePrimeagen',
    })

    expect(result).toContain('self-hosted Postgres on a VPS')
    expect(result).toContain('prefers Drizzle ORM')
    expect(result).toContain('using Next.js App Router')
    // Bullets should be stripped
    expect(result.every((f) => !f.startsWith('-'))).toBe(true)
    expect(result.every((f) => !f.startsWith('•'))).toBe(true)
  })

  it('parses numbered model output into clean statements', async () => {
    const numberedResponse =
      '1. self-hosted Postgres on a VPS\n2. prefers Drizzle ORM\n3. building with Next.js'

    mockGenerateTextFast.mockResolvedValue(numberedResponse)

    const result = await distillFacts({
      thread: drizzleThread,
      existingFacts: [],
      channelName: 'ThePrimeagen',
    })

    expect(result).toContain('self-hosted Postgres on a VPS')
    expect(result).toContain('prefers Drizzle ORM')
    // Numbering should be stripped
    expect(result.every((f) => !/^\d+\./.test(f))).toBe(true)
  })

  it('drops empty lines from parsed output', async () => {
    const sparseResponse = '- self-hosted Postgres\n\n\n- prefers Drizzle\n  \n- using Next.js'

    mockGenerateTextFast.mockResolvedValue(sparseResponse)

    const result = await distillFacts({
      thread: drizzleThread,
      existingFacts: [],
      channelName: 'ThePrimeagen',
    })

    expect(result).toHaveLength(3)
    expect(result.every((f) => f.trim().length > 0)).toBe(true)
  })

  it('trims whitespace from parsed statements', async () => {
    mockGenerateTextFast.mockResolvedValue('  self-hosted Postgres  \n  prefers Drizzle  ')

    const result = await distillFacts({
      thread: drizzleThread,
      existingFacts: [],
      channelName: 'ThePrimeagen',
    })

    expect(result).toContain('self-hosted Postgres')
    expect(result).toContain('prefers Drizzle')
    expect(result.every((f) => f === f.trim())).toBe(true)
  })
})

// ── Hard cap ──────────────────────────────────────────────────────────────────

describe('distillFacts - hard cap of 5', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('applies hard cap of 5 after merge - newest kept', async () => {
    // Model returns 7 facts
    const sevenFacts = [
      'fact one',
      'fact two',
      'fact three',
      'fact four',
      'fact five',
      'fact six',
      'fact seven',
    ].join('\n')

    mockGenerateTextFast.mockResolvedValue(sevenFacts)

    const result = await distillFacts({
      thread: drizzleThread,
      existingFacts: [],
      channelName: 'ThePrimeagen',
    })

    expect(result).toHaveLength(5)
    // Newest 5 kept (last 5 in the list)
    expect(result).toContain('fact three')
    expect(result).toContain('fact four')
    expect(result).toContain('fact five')
    expect(result).toContain('fact six')
    expect(result).toContain('fact seven')
    // First two evicted
    expect(result).not.toContain('fact one')
    expect(result).not.toContain('fact two')
  })

  it('returns exactly 5 facts when model returns exactly 5', async () => {
    const fiveFacts = 'fact A\nfact B\nfact C\nfact D\nfact E'

    mockGenerateTextFast.mockResolvedValue(fiveFacts)

    const result = await distillFacts({
      thread: drizzleThread,
      existingFacts: [],
      channelName: 'ThePrimeagen',
    })

    expect(result).toHaveLength(5)
  })
})

// ── Prompt content ────────────────────────────────────────────────────────────

describe('distillFacts - prompt content', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passes existing facts into the prompt for reconciliation', async () => {
    mockGenerateTextFast.mockResolvedValue('exploring advanced TypeScript patterns')

    const existingFacts = ['prefers Python', 'uses Flask']
    await distillFacts({
      thread: typescriptThread,
      existingFacts,
      channelName: 'ThePrimeagen',
    })

    expect(mockGenerateTextFast).toHaveBeenCalledOnce()
    const promptArg = mockGenerateTextFast.mock.calls[0]![0] as string

    // Existing facts must appear in the prompt
    expect(promptArg).toContain('prefers Python')
    expect(promptArg).toContain('uses Flask')
  })

  it('passes the channel name into the prompt for domain anchoring', async () => {
    mockGenerateTextFast.mockResolvedValue('exploring advanced TypeScript patterns')

    await distillFacts({
      thread: typescriptThread,
      existingFacts: [],
      channelName: 'ThePrimeagen',
    })

    const promptArg = mockGenerateTextFast.mock.calls[0]![0] as string
    expect(promptArg).toContain('ThePrimeagen')
  })

  it('includes the thread conversation in the prompt', async () => {
    mockGenerateTextFast.mockResolvedValue('interested in TypeScript generics')

    await distillFacts({
      thread: typescriptThread,
      existingFacts: [],
      channelName: 'ThePrimeagen',
    })

    const promptArg = mockGenerateTextFast.mock.calls[0]![0] as string

    // Thread questions/answers should appear in the prompt
    expect(promptArg).toContain('How do TypeScript generics work?')
  })

  it('passes signal to generateTextFast when provided', async () => {
    mockGenerateTextFast.mockResolvedValue('exploring TypeScript')
    const controller = new AbortController()

    await distillFacts({
      thread: typescriptThread,
      existingFacts: [],
      channelName: 'ThePrimeagen',
      signal: controller.signal,
    })

    expect(mockGenerateTextFast).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: controller.signal }),
    )
  })

  it('instructs the model to resolve contradictions in the prompt text', async () => {
    mockGenerateTextFast.mockResolvedValue('exploring TypeScript patterns')

    await distillFacts({
      thread: typescriptThread,
      existingFacts: ['prefers Python'],
      channelName: 'ThePrimeagen',
    })

    const promptArg = mockGenerateTextFast.mock.calls[0]![0] as string

    // Prompt should mention contradiction resolution / newer thread wins
    const lowerPrompt = promptArg.toLowerCase()
    const mentionsConflict =
      lowerPrompt.includes('contradict') ||
      lowerPrompt.includes('conflict') ||
      lowerPrompt.includes('reconcil') ||
      lowerPrompt.includes('newer') ||
      lowerPrompt.includes('supersed') ||
      lowerPrompt.includes('overrid')

    expect(mentionsConflict).toBe(true)
  })
})

// ── Empty thread edge case ────────────────────────────────────────────────────

describe('distillFacts - edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('handles empty thread by still calling generateTextFast', async () => {
    mockGenerateTextFast.mockResolvedValue('exploring TypeScript')

    await distillFacts({
      thread: [],
      existingFacts: [],
      channelName: 'ThePrimeagen',
    })

    expect(mockGenerateTextFast).toHaveBeenCalledOnce()
  })

  it('handles single-line model response without bullet or number', async () => {
    mockGenerateTextFast.mockResolvedValue('exploring advanced TypeScript patterns')

    const result = await distillFacts({
      thread: typescriptThread,
      existingFacts: [],
      channelName: 'ThePrimeagen',
    })

    expect(result).toEqual(['exploring advanced TypeScript patterns'])
  })

  it('strips asterisk bullets from model output', async () => {
    mockGenerateTextFast.mockResolvedValue('* self-hosted Postgres\n* prefers Drizzle')

    const result = await distillFacts({
      thread: drizzleThread,
      existingFacts: [],
      channelName: 'ThePrimeagen',
    })

    expect(result).toContain('self-hosted Postgres')
    expect(result).toContain('prefers Drizzle')
    expect(result.every((f) => !f.startsWith('*'))).toBe(true)
  })
})
