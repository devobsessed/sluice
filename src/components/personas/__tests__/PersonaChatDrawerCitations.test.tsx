import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PersonaChatDrawer } from '../PersonaChatDrawer'
import type { PersonaChatState, SourceChunk } from '@/hooks/usePersonaChat'

// Mutable state for per-test customisation
let mockState: PersonaChatState = {
  entries: [],
  messages: [],
  isStreaming: false,
  error: null,
}
let mockLiveSources: SourceChunk[] | null = null

const mockSendMessage = vi.fn()
const mockClearHistory = vi.fn()
const mockStartNewThread = vi.fn()

vi.mock('@/hooks/usePersonaChat', () => ({
  usePersonaChat: () => ({
    state: mockState,
    liveSources: mockLiveSources,
    sendMessage: mockSendMessage,
    clearHistory: mockClearHistory,
    startNewThread: mockStartNewThread,
  }),
  isThreadBoundary: (entry: { type?: string }) =>
    'type' in entry && entry.type === 'thread-boundary',
  isChatMessage: (entry: { type?: string }) =>
    !('type' in entry && entry.type === 'thread-boundary'),
}))

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  personaId: 1,
  personaName: 'Fireship',
  channelName: 'Fireship',
}

function renderDrawer(props = {}) {
  return render(<PersonaChatDrawer {...defaultProps} {...props} />)
}

const liveSourcesFixture: SourceChunk[] = [
  {
    chunkId: 10,
    content: 'React is a declarative library',
    videoTitle: 'React in 100 Seconds',
    startTime: 42,
    youtubeId: 'vid123',
  },
  {
    chunkId: 20,
    content: 'Components are reusable building blocks',
    videoTitle: 'React in 100 Seconds',
    startTime: 90,
    youtubeId: 'vid123',
  },
  {
    chunkId: 30,
    content: 'Hooks replaced class components',
    videoTitle: 'React Hooks Explained',
    startTime: null,
    youtubeId: null,
  },
]

describe('PersonaChatDrawer - citation rendering', () => {
  beforeEach(() => {
    mockState = {
      entries: [],
      messages: [],
      isStreaming: false,
      error: null,
    }
    mockLiveSources = null
    mockSendMessage.mockClear()
    mockClearHistory.mockClear()
    mockStartNewThread.mockClear()
  })

  it('live answer [n] renders clickable and scrolls/highlights matching source', () => {
    mockLiveSources = liveSourcesFixture

    const message = {
      question: 'What is React?',
      answer: 'React [1] is a great library for building UIs. Hooks [3] changed everything.',
      timestamp: 1000000,
      isStreaming: false,
      isError: false,
    }
    mockState = {
      entries: [message],
      messages: [message],
      isStreaming: false,
      error: null,
    }

    renderDrawer()

    // [1] and [3] should render as clickable buttons/links for the live answer
    const citationOne = screen.getByRole('button', { name: /\[1\]/i })
    expect(citationOne).toBeInTheDocument()
    const citationThree = screen.getByRole('button', { name: /\[3\]/i })
    expect(citationThree).toBeInTheDocument()
  })

  it('historical answer [n] renders as non-clickable styled text and does not crash', () => {
    // No liveSources - simulates a historical message after reload
    mockLiveSources = null

    const message = {
      question: 'What is React?',
      answer: 'React [1] is a great library.',
      timestamp: 1000000,
      isStreaming: false,
      isError: false,
    }
    mockState = {
      entries: [message],
      messages: [message],
      isStreaming: false,
      error: null,
    }

    // Must not crash
    expect(() => renderDrawer()).not.toThrow()

    // [1] should render as de-emphasized text, not a clickable button
    // The text "[1]" should appear but not as a button
    const citationButtons = screen.queryAllByRole('button', { name: /\[1\]/i })
    expect(citationButtons).toHaveLength(0)

    // The de-emphasized marker should still be visible
    expect(screen.getByText('[1]')).toBeInTheDocument()
  })

  it('uncited answer renders no SourceCitation list and no orphan markers', () => {
    mockLiveSources = liveSourcesFixture

    const message = {
      question: 'What is React?',
      answer: 'React is a great library.',
      timestamp: 1000000,
      isStreaming: false,
      isError: false,
    }
    mockState = {
      entries: [message],
      messages: [message],
      isStreaming: false,
      error: null,
    }

    renderDrawer()

    // No citation buttons since no [n] markers in answer
    expect(screen.queryByRole('button', { name: /\[\d+\]/i })).not.toBeInTheDocument()
    // No SourceCitation collapsible trigger
    expect(screen.queryByRole('button', { name: /source/i })).not.toBeInTheDocument()
  })

  it('SourceCitation list renders below the live answer', async () => {
    const user = userEvent.setup()
    mockLiveSources = liveSourcesFixture

    const message = {
      question: 'What is React?',
      answer: 'React [1] is declarative.',
      timestamp: 1000000,
      isStreaming: false,
      isError: false,
    }
    mockState = {
      entries: [message],
      messages: [message],
      isStreaming: false,
      error: null,
    }

    renderDrawer()

    // The SourceCitation collapsible trigger should be visible
    const sourceTrigger = screen.getByRole('button', { name: /source/i })
    expect(sourceTrigger).toBeInTheDocument()

    // Expand it
    await user.click(sourceTrigger)

    // Should show the source content
    expect(screen.getByText('React is a declarative library')).toBeInTheDocument()
  })

  it('clicking [n] opens the collapsible and highlights the matching source', async () => {
    const user = userEvent.setup()
    mockLiveSources = liveSourcesFixture

    const message = {
      question: 'What is React?',
      answer: 'React [1] is declarative.',
      timestamp: 1000000,
      isStreaming: false,
      isError: false,
    }
    mockState = {
      entries: [message],
      messages: [message],
      isStreaming: false,
      error: null,
    }

    renderDrawer()

    // Click the [1] citation button
    const citationOne = screen.getByRole('button', { name: /\[1\]/i })
    await user.click(citationOne)

    // SourceCitation should now be open showing the first source
    await waitFor(() => {
      expect(screen.getByText('React is a declarative library')).toBeInTheDocument()
    })
  })

  it('clamps out-of-range [n] markers - does not crash for [99]', () => {
    mockLiveSources = liveSourcesFixture // only 3 sources

    const message = {
      question: 'What is React?',
      answer: 'React [99] is amazing.',
      timestamp: 1000000,
      isStreaming: false,
      isError: false,
    }
    mockState = {
      entries: [message],
      messages: [message],
      isStreaming: false,
      error: null,
    }

    // Must not crash
    expect(() => renderDrawer()).not.toThrow()

    // Out-of-range [99] should not render as a clickable button
    const outOfRangeButton = screen.queryByRole('button', { name: /\[99\]/i })
    expect(outOfRangeButton).not.toBeInTheDocument()
  })
})

describe('PersonaChatDrawer - header dropdown menu', () => {
  beforeEach(() => {
    mockState = {
      entries: [],
      messages: [],
      isStreaming: false,
      error: null,
    }
    mockLiveSources = null
    mockSendMessage.mockClear()
  })

  it('header renders a dropdown menu trigger', () => {
    renderDrawer()
    expect(screen.getByRole('button', { name: /persona actions/i })).toBeInTheDocument()
  })

  it('dropdown menu contains Regenerate persona item', async () => {
    const user = userEvent.setup()
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { id: 1 } }),
    })

    renderDrawer()

    const trigger = screen.getByRole('button', { name: /persona actions/i })
    await user.click(trigger)

    expect(screen.getByRole('menuitem', { name: /regenerate persona/i })).toBeInTheDocument()
  })
})
