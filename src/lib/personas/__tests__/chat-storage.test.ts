import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  loadChatStorage,
  saveChatStorage,
  getContextWindow,
  getLastMessage,
  getAllPersonaChatIds,
  clearChatStorage,
  addFactsToStorage,
  replaceFacts,
  removeFact,
  clearFacts,
  isThreadBoundary,
  isChatMessage,
  MAX_FACTS,
  type ChatMessage,
  type ChatStorageV2,
  type ChatStorageV3,
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
  it('returns empty v3 when no data exists', () => {
    const result = loadChatStorage(1)
    expect(result).toEqual({ version: 3, entries: [], facts: [] })
  })

  it('migrates v2 data to v3, preserving entries', () => {
    const v2Data: ChatStorageV2 = {
      version: 2,
      entries: [{ question: 'Q', answer: 'A', timestamp: 1000 }],
    }
    store['persona-chat:1'] = JSON.stringify(v2Data)
    const result = loadChatStorage(1)
    expect(result.version).toBe(3)
    expect(result.entries).toHaveLength(1)
  })

  it('migrates v1 bare array to v3 with thread boundary', () => {
    const v1Data = [
      { question: 'Old Q', answer: 'Old A', timestamp: 500 },
      { question: 'Old Q2', answer: 'Old A2', timestamp: 600 },
    ]
    store['persona-chat:1'] = JSON.stringify(v1Data)
    const result = loadChatStorage(1)
    expect(result.version).toBe(3)
    // First entry should be a thread boundary
    expect(isThreadBoundary(result.entries[0]!)).toBe(true)
    // Remaining are the original messages
    expect(result.entries).toHaveLength(3) // boundary + 2 messages
  })

  it('persists migrated v3 data to localStorage after v1 migration', () => {
    const v1Data = [{ question: 'Q', answer: 'A', timestamp: 1000 }]
    store['persona-chat:1'] = JSON.stringify(v1Data)
    loadChatStorage(1)
    // Should have been re-saved as v3
    const reSaved = JSON.parse(store['persona-chat:1']!)
    expect(reSaved.version).toBe(3)
  })

  it('returns empty v3 for malformed JSON', () => {
    store['persona-chat:1'] = 'not-json'
    expect(loadChatStorage(1)).toEqual({ version: 3, entries: [], facts: [] })
  })

  it('returns empty v3 for non-array non-object data', () => {
    store['persona-chat:1'] = JSON.stringify('string')
    expect(loadChatStorage(1)).toEqual({ version: 3, entries: [], facts: [] })
  })
})

describe('saveChatStorage', () => {
  it('strips streaming and error messages', () => {
    const data: ChatStorageV3 = {
      version: 3,
      entries: [
        { question: 'Good', answer: 'Yes', timestamp: 1 },
        { question: 'Bad', answer: '', timestamp: 2, isStreaming: true },
        { question: 'Err', answer: '', timestamp: 3, isError: true },
      ],
      facts: [],
    }
    saveChatStorage(1, data)
    const saved = JSON.parse(store['persona-chat:1']!) as ChatStorageV3
    expect(saved.entries).toHaveLength(1)
    expect((saved.entries[0] as ChatMessage).question).toBe('Good')
  })

  it('preserves thread boundaries', () => {
    const data: ChatStorageV3 = {
      version: 3,
      entries: [
        { type: 'thread-boundary', timestamp: 1 },
        { question: 'Q', answer: 'A', timestamp: 2 },
      ],
      facts: [],
    }
    saveChatStorage(1, data)
    const saved = JSON.parse(store['persona-chat:1']!) as ChatStorageV3
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

// ── v3 envelope tests ─────────────────────────────────────────────────────────

describe('v3 envelope - loadChatStorage migration', () => {
  it('migrates v2 envelope to v3 adding empty facts, preserving entries', () => {
    const v2Data: ChatStorageV2 = {
      version: 2,
      entries: [{ question: 'Q', answer: 'A', timestamp: 1000 }],
    }
    store['persona-chat:1'] = JSON.stringify(v2Data)
    const result = loadChatStorage(1)
    expect(result.version).toBe(3)
    expect((result as ChatStorageV3).facts).toEqual([])
    expect(result.entries).toHaveLength(1)
    expect((result.entries[0] as ChatMessage).question).toBe('Q')
  })

  it('migrates v1 bare array to v3 with boundary and empty facts', () => {
    const v1Data = [
      { question: 'Old Q', answer: 'Old A', timestamp: 500 },
    ]
    store['persona-chat:1'] = JSON.stringify(v1Data)
    const result = loadChatStorage(1) as ChatStorageV3
    expect(result.version).toBe(3)
    expect(result.facts).toEqual([])
    // First entry should be a thread boundary
    expect(isThreadBoundary(result.entries[0]!)).toBe(true)
    // Original message preserved
    expect(result.entries).toHaveLength(2)
    expect((result.entries[1] as ChatMessage).question).toBe('Old Q')
  })

  it('loads v3 data as-is without migration', () => {
    const v3Data: ChatStorageV3 = {
      version: 3,
      entries: [{ question: 'Q', answer: 'A', timestamp: 1000 }],
      facts: ['knows TypeScript'],
    }
    store['persona-chat:1'] = JSON.stringify(v3Data)
    const result = loadChatStorage(1) as ChatStorageV3
    expect(result.version).toBe(3)
    expect(result.facts).toEqual(['knows TypeScript'])
    expect(result.entries).toHaveLength(1)
  })

  it('returns empty v3 when no data exists', () => {
    const result = loadChatStorage(1) as ChatStorageV3
    expect(result.version).toBe(3)
    expect(result.facts).toEqual([])
    expect(result.entries).toEqual([])
  })
})

describe('v3 envelope - saveChatStorage persists facts', () => {
  it('saveChatStorage persists facts (does not drop them)', () => {
    const v3Data: ChatStorageV3 = {
      version: 3,
      entries: [],
      facts: ['a', 'b'],
    }
    saveChatStorage(1, v3Data)
    const saved = JSON.parse(store['persona-chat:1']!) as ChatStorageV3
    expect(saved.version).toBe(3)
    expect(saved.facts).toEqual(['a', 'b'])
  })

  it('persists facts alongside cleaned entries', () => {
    const v3Data: ChatStorageV3 = {
      version: 3,
      entries: [
        { question: 'Good', answer: 'Yes', timestamp: 1 },
        { question: 'Streaming', answer: '', timestamp: 2, isStreaming: true },
      ],
      facts: ['uses Postgres'],
    }
    saveChatStorage(1, v3Data)
    const saved = JSON.parse(store['persona-chat:1']!) as ChatStorageV3
    // Streaming entry stripped, facts preserved
    expect(saved.entries).toHaveLength(1)
    expect(saved.facts).toEqual(['uses Postgres'])
  })
})

describe('addFactsToStorage', () => {
  it('adds facts to an empty storage', () => {
    const result = addFactsToStorage(1, ['uses TypeScript', 'likes Postgres'])
    expect(result.facts).toEqual(['uses TypeScript', 'likes Postgres'])
  })

  it('appends new facts to existing ones', () => {
    const v3Data: ChatStorageV3 = {
      version: 3,
      entries: [],
      facts: ['existing fact'],
    }
    store['persona-chat:1'] = JSON.stringify(v3Data)
    const result = addFactsToStorage(1, ['new fact'])
    expect(result.facts).toEqual(['existing fact', 'new fact'])
  })

  it('caps at MAX_FACTS (5) newest-evicts-oldest', () => {
    // Add 4 facts first
    const initial: ChatStorageV3 = {
      version: 3,
      entries: [],
      facts: ['fact1', 'fact2', 'fact3', 'fact4'],
    }
    store['persona-chat:1'] = JSON.stringify(initial)
    // Now add 3 more - only the newest 5 total should remain
    const result = addFactsToStorage(1, ['fact5', 'fact6', 'fact7'])
    expect(result.facts).toHaveLength(MAX_FACTS)
    // Oldest (fact1, fact2) evicted; newest 5 kept in order
    expect(result.facts).toEqual(['fact3', 'fact4', 'fact5', 'fact6', 'fact7'])
  })

  it('MAX_FACTS is 5', () => {
    expect(MAX_FACTS).toBe(5)
  })

  it('persists to localStorage after adding', () => {
    addFactsToStorage(1, ['persisted fact'])
    const saved = JSON.parse(store['persona-chat:1']!) as ChatStorageV3
    expect(saved.facts).toEqual(['persisted fact'])
  })
})

describe('replaceFacts', () => {
  it('replaces existing facts instead of appending (no double-merge duplicates)', () => {
    // The compress-thread endpoint returns the MERGED set (existing facts went
    // into the request). Replacing must not re-append the existing facts.
    const v3Data: ChatStorageV3 = {
      version: 3,
      entries: [],
      facts: ['values type safety', 'building an agent'],
    }
    store['persona-chat:1'] = JSON.stringify(v3Data)
    const merged = ['values type safety', 'building an agent', 'exploring workflows']
    const result = replaceFacts(1, merged)
    expect(result.facts).toEqual(merged)
  })

  it('dedupes the incoming set preserving first occurrence', () => {
    const result = replaceFacts(1, ['a', 'b', 'a', 'c'])
    expect(result.facts).toEqual(['a', 'b', 'c'])
  })

  it('applies the MAX_FACTS cap as a backstop', () => {
    const result = replaceFacts(1, ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7'])
    expect(result.facts).toHaveLength(MAX_FACTS)
    expect(result.facts).toEqual(['f3', 'f4', 'f5', 'f6', 'f7'])
  })

  it('persists to localStorage', () => {
    replaceFacts(1, ['replaced fact'])
    const saved = JSON.parse(store['persona-chat:1']!) as ChatStorageV3
    expect(saved.facts).toEqual(['replaced fact'])
  })
})

describe('removeFact', () => {
  it('removes a specific fact by value', () => {
    const v3Data: ChatStorageV3 = {
      version: 3,
      entries: [],
      facts: ['fact A', 'fact B', 'fact C'],
    }
    store['persona-chat:1'] = JSON.stringify(v3Data)
    const result = removeFact(1, 'fact B')
    expect(result.facts).toEqual(['fact A', 'fact C'])
  })

  it('persists after remove', () => {
    const v3Data: ChatStorageV3 = {
      version: 3,
      entries: [],
      facts: ['keep', 'remove me'],
    }
    store['persona-chat:1'] = JSON.stringify(v3Data)
    removeFact(1, 'remove me')
    const saved = JSON.parse(store['persona-chat:1']!) as ChatStorageV3
    expect(saved.facts).toEqual(['keep'])
  })

  it('is a no-op when fact does not exist', () => {
    const v3Data: ChatStorageV3 = {
      version: 3,
      entries: [],
      facts: ['fact A'],
    }
    store['persona-chat:1'] = JSON.stringify(v3Data)
    const result = removeFact(1, 'nonexistent')
    expect(result.facts).toEqual(['fact A'])
  })
})

describe('clearFacts', () => {
  it('clears all facts', () => {
    const v3Data: ChatStorageV3 = {
      version: 3,
      entries: [],
      facts: ['fact1', 'fact2'],
    }
    store['persona-chat:1'] = JSON.stringify(v3Data)
    const result = clearFacts(1)
    expect(result.facts).toEqual([])
  })

  it('persists after clear', () => {
    const v3Data: ChatStorageV3 = {
      version: 3,
      entries: [],
      facts: ['fact1'],
    }
    store['persona-chat:1'] = JSON.stringify(v3Data)
    clearFacts(1)
    const saved = JSON.parse(store['persona-chat:1']!) as ChatStorageV3
    expect(saved.facts).toEqual([])
  })

  it('preserves entries while clearing facts', () => {
    const v3Data: ChatStorageV3 = {
      version: 3,
      entries: [{ question: 'Q', answer: 'A', timestamp: 1 }],
      facts: ['fact1'],
    }
    store['persona-chat:1'] = JSON.stringify(v3Data)
    const result = clearFacts(1)
    expect(result.facts).toEqual([])
    expect(result.entries).toHaveLength(1)
  })
})
