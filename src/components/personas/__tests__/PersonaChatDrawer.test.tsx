import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PersonaChatDrawer } from '../PersonaChatDrawer'
import type { PersonaChatState } from '@/hooks/usePersonaChat'

// Mutable state object so individual tests can modify it
let mockState: PersonaChatState = {
  entries: [],
  messages: [],
  isStreaming: false,
  error: null,
}

const mockSendMessage = vi.fn()
const mockClearHistory = vi.fn()
const mockStartNewThread = vi.fn()

vi.mock('@/hooks/usePersonaChat', () => ({
  usePersonaChat: () => ({
    state: mockState,
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
  expertiseTopics: ['React', 'TypeScript', 'Next.js', 'Svelte'],
}

function renderDrawer(props = {}) {
  return render(<PersonaChatDrawer {...defaultProps} {...props} />)
}

describe('PersonaChatDrawer', () => {
  beforeEach(() => {
    mockState = {
      entries: [],
      messages: [],
      isStreaming: false,
      error: null,
    }
    mockSendMessage.mockClear()
    mockClearHistory.mockClear()
    mockStartNewThread.mockClear()
  })

  it('renders persona name in header', () => {
    renderDrawer()
    expect(screen.getByText('Fireship')).toBeInTheDocument()
  })

  it('renders expertise topics (first 3 joined by comma)', () => {
    renderDrawer()
    expect(screen.getByText('React, TypeScript, Next.js')).toBeInTheDocument()
  })

  it('shows avatar with first letter of persona name', () => {
    renderDrawer()
    expect(screen.getByText('F')).toBeInTheDocument()
  })

  it('shows empty state when no messages', () => {
    renderDrawer()
    expect(screen.getByText('Ask Fireship anything...')).toBeInTheDocument()
  })

  it('shows memory indicator', () => {
    renderDrawer()
    expect(screen.getByText('Remembers last 50 exchanges')).toBeInTheDocument()
  })

  it('renders input placeholder with persona name', () => {
    renderDrawer()
    const input = screen.getByPlaceholderText('Ask Fireship anything...')
    expect(input).toBeInTheDocument()
  })

  it('disables send button when input is empty', () => {
    renderDrawer()
    const sendButton = screen.getByRole('button', { name: /send/i })
    expect(sendButton).toBeDisabled()
  })

  it('enables send button when input has text', async () => {
    const user = userEvent.setup()
    renderDrawer()
    const input = screen.getByPlaceholderText('Ask Fireship anything...')
    await user.type(input, 'What is React?')
    const sendButton = screen.getByRole('button', { name: /send/i })
    expect(sendButton).not.toBeDisabled()
  })

  it('calls sendMessage on form submit', async () => {
    const user = userEvent.setup()
    renderDrawer()
    const input = screen.getByPlaceholderText('Ask Fireship anything...')
    await user.type(input, 'What is React?')
    await user.keyboard('{Enter}')
    expect(mockSendMessage).toHaveBeenCalledWith('What is React?')
  })

  it('clears input after submit', async () => {
    const user = userEvent.setup()
    renderDrawer()
    const input = screen.getByPlaceholderText('Ask Fireship anything...')
    await user.type(input, 'What is React?')
    await user.keyboard('{Enter}')
    expect(input).toHaveValue('')
  })

  it('does not submit on Shift+Enter', async () => {
    const user = userEvent.setup()
    renderDrawer()
    const input = screen.getByPlaceholderText('Ask Fireship anything...')
    await user.type(input, 'What is React?')
    await user.keyboard('{Shift>}{Enter}{/Shift}')
    expect(mockSendMessage).not.toHaveBeenCalled()
  })

  it('renders messages in thread', () => {
    const messages = [
      {
        question: 'What is React?',
        answer: 'React is a UI library.',
        timestamp: 1000000,
        isStreaming: false,
        isError: false,
      },
    ]
    mockState = {
      entries: messages,
      messages,
      isStreaming: false,
      error: null,
    }
    renderDrawer()
    expect(screen.getByText('What is React?')).toBeInTheDocument()
    expect(screen.getByText('React is a UI library.')).toBeInTheDocument()
  })

  it('shows streaming cursor during active stream', () => {
    const messages = [
      {
        question: 'What is React?',
        answer: 'React is',
        timestamp: 1000000,
        isStreaming: true,
        isError: false,
      },
    ]
    mockState = {
      entries: messages,
      messages,
      isStreaming: true,
      error: null,
    }
    renderDrawer()
    // The streaming cursor character should be present
    expect(screen.getByText(/▌/)).toBeInTheDocument()
  })

  it('disables input during streaming', () => {
    mockState = {
      entries: [],
      messages: [],
      isStreaming: true,
      error: null,
    }
    renderDrawer()
    const input = screen.getByPlaceholderText('Ask Fireship anything...')
    expect(input).toBeDisabled()
  })

  it('shows error message with retry button when message has error', () => {
    const messages = [
      {
        question: 'What is React?',
        answer: '',
        timestamp: 1000000,
        isStreaming: false,
        isError: true,
      },
    ]
    mockState = {
      entries: messages,
      messages,
      isStreaming: false,
      error: 'Something went wrong',
    }
    renderDrawer()
    expect(screen.getByText('Something went wrong, try again')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })

  it('calls sendMessage with the failed question when retry is clicked', async () => {
    const user = userEvent.setup()
    const messages = [
      {
        question: 'What is React?',
        answer: '',
        timestamp: 1000000,
        isStreaming: false,
        isError: true,
      },
    ]
    mockState = {
      entries: messages,
      messages,
      isStreaming: false,
      error: 'Something went wrong',
    }
    renderDrawer()
    const retryButton = screen.getByRole('button', { name: /retry/i })
    await user.click(retryButton)
    expect(mockSendMessage).toHaveBeenCalledWith('What is React?')
  })

  it('shows clear history button when messages exist', () => {
    const messages = [
      {
        question: 'What is React?',
        answer: 'React is a UI library.',
        timestamp: 1000000,
        isStreaming: false,
        isError: false,
      },
    ]
    mockState = {
      entries: messages,
      messages,
      isStreaming: false,
      error: null,
    }
    renderDrawer()
    expect(screen.getByRole('button', { name: /clear history/i })).toBeInTheDocument()
  })

  it('does not show clear history button when no messages', () => {
    renderDrawer()
    expect(screen.queryByRole('button', { name: /clear history/i })).not.toBeInTheDocument()
  })

  it('calls clearHistory when clear button clicked', async () => {
    const user = userEvent.setup()
    const messages = [
      {
        question: 'What is React?',
        answer: 'React is a UI library.',
        timestamp: 1000000,
        isStreaming: false,
        isError: false,
      },
    ]
    mockState = {
      entries: messages,
      messages,
      isStreaming: false,
      error: null,
    }
    renderDrawer()
    const clearButton = screen.getByRole('button', { name: /clear history/i })
    await user.click(clearButton)
    expect(mockClearHistory).toHaveBeenCalledOnce()
  })

  it('does not render drawer content when open is false', () => {
    renderDrawer({ open: false })
    // Persona name should not be visible in the header when closed
    // The SheetTitle is inside a dialog that's not visible when closed
    expect(screen.queryByText('Ask Fireship anything...')).not.toBeInTheDocument()
  })

  it('shows loading skeleton when streaming with no answer text yet', () => {
    const messages = [
      {
        question: 'What is React?',
        answer: '',
        timestamp: 1000000,
        isStreaming: true,
        isError: false,
      },
    ]
    mockState = {
      entries: messages,
      messages,
      isStreaming: true,
      error: null,
    }
    renderDrawer()
    // Skeleton elements should appear when streaming but no text yet
    const skeletons = screen.getAllByTestId('streaming-skeleton')
    expect(skeletons.length).toBeGreaterThan(0)
  })

  it('handles missing expertiseTopics gracefully', () => {
    renderDrawer({ expertiseTopics: undefined })
    // Should render without crashing
    expect(screen.getByText('Fireship')).toBeInTheDocument()
  })

  it('shows only first 3 expertise topics', () => {
    renderDrawer()
    // Should show "React, TypeScript, Next.js" — NOT "Svelte"
    expect(screen.getByText('React, TypeScript, Next.js')).toBeInTheDocument()
    expect(screen.queryByText(/Svelte/)).not.toBeInTheDocument()
  })

  it('renders mobile back arrow', () => {
    renderDrawer()
    expect(screen.getByLabelText('Close chat')).toBeInTheDocument()
  })

  it('calls onOpenChange when back arrow clicked', async () => {
    const onOpenChange = vi.fn()
    const user = userEvent.setup()
    render(<PersonaChatDrawer {...defaultProps} onOpenChange={onOpenChange} />)
    await user.click(screen.getByLabelText('Close chat'))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('has accessible labels on input and send button', () => {
    render(<PersonaChatDrawer {...defaultProps} personaName="Theo Browne" />)
    expect(screen.getByLabelText('Ask Theo Browne a question')).toBeInTheDocument()
    expect(screen.getByLabelText('Send message')).toBeInTheDocument()
  })

  it('renders error message in failed message bubble', () => {
    const messages = [
      { question: 'Test', answer: '', timestamp: Date.now(), isError: true },
    ]
    mockState.messages = messages
    mockState.entries = messages
    renderDrawer()
    expect(screen.getByText('Something went wrong, try again')).toBeInTheDocument()
  })

  it('renders answer paragraphs separated by double newlines', () => {
    const messages = [
      {
        question: 'Explain React?',
        answer: 'React is a UI library.\n\nIt uses a virtual DOM.\n\nComponents are the building blocks.',
        timestamp: 1000000,
        isStreaming: false,
        isError: false,
      },
    ]
    mockState = {
      entries: messages,
      messages,
      isStreaming: false,
      error: null,
    }
    renderDrawer()
    const paragraphs = screen.getAllByRole('paragraph')
    // Find the answer paragraphs (not the timestamp paragraph or other text)
    const answerParagraphs = paragraphs.filter(
      (p) =>
        p.textContent === 'React is a UI library.' ||
        p.textContent === 'It uses a virtual DOM.' ||
        p.textContent === 'Components are the building blocks.'
    )
    expect(answerParagraphs).toHaveLength(3)
    expect(answerParagraphs[0]?.tagName).toBe('P')
    expect(answerParagraphs[1]?.tagName).toBe('P')
    expect(answerParagraphs[2]?.tagName).toBe('P')
  })

  it('renders single-paragraph answer (no double newlines) as one <p> element', () => {
    const messages = [
      {
        question: 'What is React?',
        answer: 'React is a UI library.',
        timestamp: 1000000,
        isStreaming: false,
        isError: false,
      },
    ]
    mockState = {
      entries: messages,
      messages,
      isStreaming: false,
      error: null,
    }
    renderDrawer()
    // Only one paragraph should match the answer text
    const answerParagraph = screen.getByText('React is a UI library.')
    expect(answerParagraph.tagName).toBe('P')
  })

  it('attaches streaming cursor to last paragraph when multi-paragraph answer is streaming', () => {
    const messages = [
      {
        question: 'Explain React?',
        answer: 'React is a UI library.\n\nIt uses a virtual DOM.',
        timestamp: 1000000,
        isStreaming: true,
        isError: false,
      },
    ]
    mockState = {
      entries: messages,
      messages,
      isStreaming: true,
      error: null,
    }
    renderDrawer()
    // Cursor should be present
    expect(screen.getByText(/▌/)).toBeInTheDocument()
    // The cursor should be in the last paragraph (the one containing "It uses a virtual DOM.")
    const lastParagraph = screen.getByText(/It uses a virtual DOM\./)
    expect(lastParagraph.textContent).toContain('▌')
  })

  it('renders thread boundary divider with label', () => {
    const boundary = { type: 'thread-boundary' as const, timestamp: 999000 }
    const messages = [
      {
        question: 'Old question?',
        answer: 'Old answer.',
        timestamp: 1000000,
        isStreaming: false,
        isError: false,
      },
    ]
    mockState = {
      entries: [boundary, ...messages],
      messages,
      isStreaming: false,
      error: null,
    }
    renderDrawer()
    // idx=0 boundary renders as "Earlier messages (no memory)"
    expect(screen.getByText('Earlier messages (no memory)')).toBeInTheDocument()
  })

  it('renders "New thread" label for non-first thread boundary', () => {
    const msg1 = {
      question: 'Old question?',
      answer: 'Old answer.',
      timestamp: 1000000,
      isStreaming: false,
      isError: false,
    }
    const boundary = { type: 'thread-boundary' as const, timestamp: 1001000 }
    const msg2 = {
      question: 'New question?',
      answer: 'New answer.',
      timestamp: 1002000,
      isStreaming: false,
      isError: false,
    }
    mockState = {
      entries: [msg1, boundary, msg2],
      messages: [msg1, msg2],
      isStreaming: false,
      error: null,
    }
    renderDrawer()
    // Non-zero idx boundary renders as "New thread"
    expect(screen.getByText('New thread')).toBeInTheDocument()
  })

  it('shows memory indicator text', () => {
    renderDrawer()
    expect(screen.getByText('Remembers last 50 exchanges')).toBeInTheDocument()
  })

  it('shows "New thread" button in header when messages exist', () => {
    const messages = [
      {
        question: 'What is React?',
        answer: 'React is a UI library.',
        timestamp: 1000000,
        isStreaming: false,
        isError: false,
      },
    ]
    mockState = {
      entries: messages,
      messages,
      isStreaming: false,
      error: null,
    }
    renderDrawer()
    expect(screen.getByRole('button', { name: /new thread/i })).toBeInTheDocument()
  })

  it('does not show "New thread" button when no messages exist', () => {
    renderDrawer()
    expect(screen.queryByRole('button', { name: /new thread/i })).not.toBeInTheDocument()
  })

  it('calls startNewThread when "New thread" button is clicked', async () => {
    const user = userEvent.setup()
    const messages = [
      {
        question: 'What is React?',
        answer: 'React is a UI library.',
        timestamp: 1000000,
        isStreaming: false,
        isError: false,
      },
    ]
    mockState = {
      entries: messages,
      messages,
      isStreaming: false,
      error: null,
    }
    renderDrawer()
    const newThreadButton = screen.getByRole('button', { name: /new thread/i })
    await user.click(newThreadButton)
    expect(mockStartNewThread).toHaveBeenCalledOnce()
  })

  it('dims messages before the last thread boundary', () => {
    const msg1 = {
      question: 'Old question?',
      answer: 'Old answer.',
      timestamp: 1000000,
      isStreaming: false,
      isError: false,
    }
    const boundary = { type: 'thread-boundary' as const, timestamp: 1001000 }
    const msg2 = {
      question: 'New question?',
      answer: 'New answer.',
      timestamp: 1002000,
      isStreaming: false,
      isError: false,
    }
    mockState = {
      entries: [msg1, boundary, msg2],
      messages: [msg1, msg2],
      isStreaming: false,
      error: null,
    }
    renderDrawer()
    // The old message bubble container should have opacity-50 class
    const oldQuestionEl = screen.getByText('Old question?')
    const messageContainer = oldQuestionEl.closest('.flex.flex-col.gap-2')
    expect(messageContainer).toHaveClass('opacity-50')
    // The new message should not be dimmed
    const newQuestionEl = screen.getByText('New question?')
    const newMessageContainer = newQuestionEl.closest('.flex.flex-col.gap-2')
    expect(newMessageContainer).not.toHaveClass('opacity-50')
  })

  it('input has text-base class for iOS zoom prevention', () => {
    renderDrawer()
    const input = screen.getByPlaceholderText('Ask Fireship anything...')
    expect(input).toHaveClass('text-base')
  })
})
