import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChatHubDrawer } from '../ChatHubDrawer'
import { PersonaStatusProvider } from '@/components/providers/PersonaStatusProvider'
import type { ChatStorageV2 } from '@/lib/personas/chat-storage'

// ── localStorage mock ──────────────────────────────────────────────────────────

function makeLocalStorageMock() {
  const store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value },
    removeItem: (key: string) => { delete store[key] },
    clear: () => { Object.keys(store).forEach((k) => { delete store[k] }) },
    get length() { return Object.keys(store).length },
    key: (index: number) => Object.keys(store)[index] ?? null,
    _store: store,
  }
}

let mockStorage = makeLocalStorageMock()

// ── usePersonaChat mock ────────────────────────────────────────────────────────

vi.mock('@/hooks/usePersonaChat', () => ({
  usePersonaChat: () => ({
    state: { entries: [], messages: [], isStreaming: false, error: null },
    sendMessage: vi.fn(),
    clearHistory: vi.fn(),
    startNewThread: vi.fn(),
  }),
  isThreadBoundary: (entry: { type?: string }) =>
    'type' in entry && entry.type === 'thread-boundary',
  isChatMessage: (entry: { type?: string }) =>
    !('type' in entry && entry.type === 'thread-boundary'),
}))

// ── Provider wrapper ───────────────────────────────────────────────────────────

function Wrapper({ children }: { children: React.ReactNode }) {
  return <PersonaStatusProvider>{children}</PersonaStatusProvider>
}

// ── Status response fixtures ───────────────────────────────────────────────────

const statusWithPersonas = {
  channels: [
    {
      channelName: 'Fireship',
      transcriptCount: 10,
      personaId: 1,
      personaCreatedAt: new Date().toISOString(),
      personaName: 'Fireship',
      expertiseTopics: ['React', 'TypeScript'],
    },
    {
      channelName: 'Theo',
      transcriptCount: 8,
      personaId: 2,
      personaCreatedAt: new Date().toISOString(),
      personaName: 'Theo Browne',
      expertiseTopics: ['Next.js', 'tRPC'],
    },
  ],
  threshold: 5,
}

const statusNoPersonas = {
  channels: [
    {
      channelName: 'Building',
      transcriptCount: 2,
      personaId: null,
      personaCreatedAt: null,
      personaName: null,
      expertiseTopics: null,
    },
  ],
  threshold: 5,
}

// ── Helper: render with resolved personas ─────────────────────────────────────

/**
 * Renders ChatHubDrawer wrapped in PersonaStatusProvider and waits for the
 * deferred fetch to complete. Uses fake timers to advance the 1500ms defer,
 * then restores real timers for subsequent interactions (Radix UI animations
 * need real timers).
 */
async function renderWithLoad(status: typeof statusWithPersonas | typeof statusNoPersonas) {
  vi.useFakeTimers()
  vi.mocked(fetch).mockResolvedValue({
    ok: true,
    json: async () => status,
  } as Response)

  const result = render(<ChatHubDrawer />, { wrapper: Wrapper })

  await act(async () => {
    await vi.advanceTimersByTimeAsync(1500)
  })

  // Restore real timers so Radix UI animations work for interactions
  vi.useRealTimers()

  return result
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  mockStorage = makeLocalStorageMock()
  Object.defineProperty(global, 'localStorage', { value: mockStorage, writable: true })
  global.fetch = vi.fn()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ChatHubDrawer', () => {
  it('renders without crashing', async () => {
    vi.useFakeTimers()
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => statusNoPersonas,
    } as Response)

    render(<ChatHubDrawer />, { wrapper: Wrapper })
    vi.useRealTimers()
  })

  it('does not show FAB when no personas exist', async () => {
    await renderWithLoad(statusNoPersonas)
    expect(screen.queryByRole('button', { name: /open chat hub/i })).not.toBeInTheDocument()
  })

  it('shows FAB after load when personas exist', async () => {
    await renderWithLoad(statusWithPersonas)
    expect(screen.getByRole('button', { name: /open chat hub/i })).toBeInTheDocument()
  })

  it('opens hub sheet on FAB click', async () => {
    const user = userEvent.setup()
    await renderWithLoad(statusWithPersonas)

    const fab = screen.getByRole('button', { name: /open chat hub/i })
    await user.click(fab)

    // Hub screen shows "Chats" heading
    await waitFor(() => {
      expect(screen.getByText('Chats')).toBeInTheDocument()
    })
  })

  it('hides FAB when sheet is open', async () => {
    const user = userEvent.setup()
    await renderWithLoad(statusWithPersonas)

    const fab = screen.getByRole('button', { name: /open chat hub/i })
    await user.click(fab)

    // After opening, FAB should have invisible class (visible=false)
    await waitFor(() => {
      // FAB is still in DOM but invisible (visible=false prop)
      const fabEl = screen.queryByLabelText('Open chat hub')
      if (fabEl) {
        expect(fabEl).toHaveClass('invisible')
      } else {
        // Or it may not be in DOM at all
        expect(fabEl).toBeNull()
      }
    })
  })

  it('opens chat screen directly via persona-chat:open CustomEvent', async () => {
    await renderWithLoad(statusWithPersonas)

    act(() => {
      window.dispatchEvent(
        new CustomEvent('persona-chat:open', {
          detail: { personaId: 1, personaName: 'Fireship', expertiseTopics: ['React'] },
        })
      )
    })

    // Should show the chat drawer content for Fireship (Back to hub button visible)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /back to hub/i })).toBeInTheDocument()
    })
  })

  it('navigates from hub to chat when persona selected', async () => {
    const user = userEvent.setup()
    await renderWithLoad(statusWithPersonas)

    // Open hub
    await user.click(screen.getByRole('button', { name: /open chat hub/i }))

    // Hub shows "Chats" heading
    await waitFor(() => {
      expect(screen.getByText('Chats')).toBeInTheDocument()
    })

    // Click on a persona pill/button
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Fireship/i })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /Fireship/i }))

    // Should now show chat screen (back to hub button visible)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /back to hub/i })).toBeInTheDocument()
    })
  })

  it('navigates back to hub from chat via back button', async () => {
    const user = userEvent.setup()
    await renderWithLoad(statusWithPersonas)

    // Open hub
    await user.click(screen.getByRole('button', { name: /open chat hub/i }))

    await waitFor(() => {
      expect(screen.getByText('Chats')).toBeInTheDocument()
    })

    // Navigate to chat
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Fireship/i })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /Fireship/i }))

    // Verify we're on chat screen
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /back to hub/i })).toBeInTheDocument()
    })

    // Go back to hub
    await user.click(screen.getByRole('button', { name: /back to hub/i }))

    // Should show hub screen again
    await waitFor(() => {
      expect(screen.getByText('Chats')).toBeInTheDocument()
    })
  })

  it('handles fetch failure gracefully (no FAB shown)', async () => {
    vi.useFakeTimers()
    vi.mocked(fetch).mockRejectedValue(new Error('Network error'))

    render(<ChatHubDrawer />, { wrapper: Wrapper })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })

    vi.useRealTimers()

    expect(screen.queryByRole('button', { name: /open chat hub/i })).not.toBeInTheDocument()
  })

  it('handles non-ok fetch response gracefully', async () => {
    vi.useFakeTimers()
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Unauthorized' }),
    } as Response)

    render(<ChatHubDrawer />, { wrapper: Wrapper })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })

    vi.useRealTimers()

    expect(screen.queryByRole('button', { name: /open chat hub/i })).not.toBeInTheDocument()
  })
})
