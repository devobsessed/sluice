import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  loadChatStorage,
  saveChatStorage,
  getContextWindow,
  getLastMessage,
  getAllPersonaChatIds,
  clearChatStorage,
  isThreadBoundary,
  isChatMessage,
  type ChatMessage,
  type ChatStorageV2,
  type ChatEntry,
  type ThreadBoundary,
} from '../chat-storage'

// In-memory localStorage mock
const store: Record<string, string> = {}
const localStorageMock = {
  getItem: vi.fn((key: string) => store[key] ?? null),
  setItem: vi.fn((key: string, value: string) => {
    store[key] = value
  }),
  removeItem: vi.fn((key: string) => {
    delete store[key]
  }),
  clear: vi.fn(() => {
    Object.keys(store).forEach((k) => delete store[k])
  }),
  key: vi.fn((i: number) => Object.keys(store)[i] ?? null),
  get length() {
    return Object.keys(store).length
  },
}
Object.defineProperty(global, 'localStorage', {
  value: localStorageMock,
  writable: true,
})

beforeEach(() => {
  localStorageMock.clear()
  vi.clearAllMocks()
})

describe('type guards', () => {
  it('isThreadBoundary returns true for boundary entries', () => {
    const b: ThreadBoundary = { type: 'thread-boundary', timestamp: 1000 }
    expect(isThreadBoundary(b)).toBe(true)
  })

  it('isChatMessage returns true for message entries', () => {
    const m: ChatMessage = { question: 'Q', answer: 'A', timestamp: 1000 }
    expect(isChatMessage(m)).toBe(true)
  })
})

describe('loadChatStorage', () => {
  it('returns empty v2 when no data exists', () => {
    const result = loadChatStorage(1)
    expect(result).toEqual({ version: 2, entries: [] })
  })

  it('loads v2 data as-is', () => {
    const v2Data: ChatStorageV2 = {
      version: 2,
      entries: [{ question: 'Q', answer: 'A', timestamp: 1000 }],
    }
    store['persona-chat:1'] = JSON.stringify(v2Data)
    const result = loadChatStorage(1)
    expect(result.version).toBe(2)
    expect(result.entries).toHaveLength(1)
  })

  it('migrates v1 bare array to v2 with thread boundary', () => {
    const v1Data = [
      { question: 'Old Q', answer: 'Old A', timestamp: 500 },
      { question: 'Old Q2', answer: 'Old A2', timestamp: 600 },
    ]
    store['persona-chat:1'] = JSON.stringify(v1Data)
    const result = loadChatStorage(1)
    expect(result.version).toBe(2)
    // First entry should be a thread boundary
    expect(isThreadBoundary(result.entries[0]!)).toBe(true)
    // Remaining are the original messages
    expect(result.entries).toHaveLength(3) // boundary + 2 messages
  })

  it('persists migrated v2 data to localStorage after v1 migration', () => {
    const v1Data = [{ question: 'Q', answer: 'A', timestamp: 1000 }]
    store['persona-chat:1'] = JSON.stringify(v1Data)
    loadChatStorage(1)
    // Should have been re-saved as v2
    const reSaved = JSON.parse(store['persona-chat:1']!)
    expect(reSaved.version).toBe(2)
  })

  it('returns empty v2 for malformed JSON', () => {
    store['persona-chat:1'] = 'not-json'
    expect(loadChatStorage(1)).toEqual({ version: 2, entries: [] })
  })

  it('returns empty v2 for non-array non-object data', () => {
    store['persona-chat:1'] = JSON.stringify('string')
    expect(loadChatStorage(1)).toEqual({ version: 2, entries: [] })
  })
})

describe('saveChatStorage', () => {
  it('strips streaming and error messages', () => {
    const data: ChatStorageV2 = {
      version: 2,
      entries: [
        { question: 'Good', answer: 'Yes', timestamp: 1 },
        { question: 'Bad', answer: '', timestamp: 2, isStreaming: true },
        { question: 'Err', answer: '', timestamp: 3, isError: true },
      ],
    }
    saveChatStorage(1, data)
    const saved = JSON.parse(store['persona-chat:1']!) as ChatStorageV2
    expect(saved.entries).toHaveLength(1)
    expect((saved.entries[0] as ChatMessage).question).toBe('Good')
  })

  it('preserves thread boundaries', () => {
    const data: ChatStorageV2 = {
      version: 2,
      entries: [
        { type: 'thread-boundary', timestamp: 1 },
        { question: 'Q', answer: 'A', timestamp: 2 },
      ],
    }
    saveChatStorage(1, data)
    const saved = JSON.parse(store['persona-chat:1']!) as ChatStorageV2
    expect(saved.entries).toHaveLength(2)
    expect(isThreadBoundary(saved.entries[0]!)).toBe(true)
  })
})

describe('getContextWindow', () => {
  it('returns all completed messages when no boundary exists', () => {
    const entries: ChatEntry[] = [
      { question: 'Q1', answer: 'A1', timestamp: 1 },
      { question: 'Q2', answer: 'A2', timestamp: 2 },
    ]
    const result = getContextWindow(entries)
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ question: 'Q1', answer: 'A1' })
  })

  it('returns only messages after the last boundary', () => {
    const entries: ChatEntry[] = [
      { question: 'Old', answer: 'Old', timestamp: 1 },
      { type: 'thread-boundary', timestamp: 2 },
      { question: 'New', answer: 'New', timestamp: 3 },
    ]
    const result = getContextWindow(entries)
    expect(result).toHaveLength(1)
    expect(result[0]!.question).toBe('New')
  })

  it('caps at 50 pairs', () => {
    const entries: ChatEntry[] = Array.from({ length: 60 }, (_, i) => ({
      question: `Q${i}`,
      answer: `A${i}`,
      timestamp: i,
    }))
    const result = getContextWindow(entries)
    expect(result).toHaveLength(50)
    // Should be the last 50 (Q10 through Q59)
    expect(result[0]!.question).toBe('Q10')
  })

  it('caps by character count (~20000 chars) and keeps newest context', () => {
    const longAnswer = 'x'.repeat(10000)
    const entries: ChatEntry[] = [
      { question: 'Q1', answer: longAnswer, timestamp: 1 },
      { question: 'Q2', answer: longAnswer, timestamp: 2 },
      { question: 'Q3', answer: longAnswer, timestamp: 3 },
    ]
    const result = getContextWindow(entries)
    // Each message is 10002 chars. Budget is 20000, so only one fits.
    // Iteration is newest-first, so Q3 is the one preserved (recent context wins).
    expect(result).toHaveLength(1)
    expect(result[0]!.question).toBe('Q3')
  })

  it('skips streaming and error messages', () => {
    const entries: ChatEntry[] = [
      { question: 'Q1', answer: 'A1', timestamp: 1 },
      { question: 'Q2', answer: '', timestamp: 2, isStreaming: true },
      { question: 'Q3', answer: '', timestamp: 3, isError: true },
    ]
    const result = getContextWindow(entries)
    expect(result).toHaveLength(1)
  })

  it('skips messages with empty answers', () => {
    const entries: ChatEntry[] = [
      { question: 'Q1', answer: '', timestamp: 1 },
      { question: 'Q2', answer: 'A2', timestamp: 2 },
    ]
    const result = getContextWindow(entries)
    expect(result).toHaveLength(1)
    expect(result[0]!.question).toBe('Q2')
  })
})

describe('getLastMessage', () => {
  it('returns the last non-error ChatMessage', () => {
    const entries: ChatEntry[] = [
      { question: 'Q1', answer: 'A1', timestamp: 1 },
      { question: 'Q2', answer: '', timestamp: 2, isError: true },
    ]
    const result = getLastMessage(entries)
    expect(result?.question).toBe('Q1')
  })

  it('returns null for empty entries', () => {
    expect(getLastMessage([])).toBeNull()
  })

  it('skips thread boundaries', () => {
    const entries: ChatEntry[] = [
      { question: 'Q1', answer: 'A1', timestamp: 1 },
      { type: 'thread-boundary', timestamp: 2 },
    ]
    const result = getLastMessage(entries)
    expect(result?.question).toBe('Q1')
  })
})

describe('getAllPersonaChatIds', () => {
  it('returns all persona IDs from localStorage keys', () => {
    store['persona-chat:1'] = '{}'
    store['persona-chat:42'] = '{}'
    store['other-key'] = '{}'
    const ids = getAllPersonaChatIds()
    expect(ids.sort()).toEqual([1, 42])
  })

  it('returns empty array when no keys match', () => {
    expect(getAllPersonaChatIds()).toEqual([])
  })
})

describe('clearChatStorage', () => {
  it('removes the key from localStorage', () => {
    store['persona-chat:1'] = '{}'
    clearChatStorage(1)
    expect(store['persona-chat:1']).toBeUndefined()
  })
})
