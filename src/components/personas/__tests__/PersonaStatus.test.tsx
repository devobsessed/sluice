import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { PersonaStatus, PersonaStatusSkeleton } from '../PersonaStatus'
import { PersonaStatusProvider } from '@/components/providers/PersonaStatusProvider'

// Mock fetch globally
global.fetch = vi.fn()

function Wrapper({ children }: { children: React.ReactNode }) {
  return <PersonaStatusProvider>{children}</PersonaStatusProvider>
}

describe('PersonaStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // Helper to advance the 1.5-second provider defer and drain all async microtasks
  async function advanceDefer() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })
  }

  it('renders loading state on initial mount', () => {
    vi.mocked(fetch).mockImplementation(() => new Promise(() => {})) // Never resolves

    render(<PersonaStatus />, { wrapper: Wrapper })

    // Should show skeleton with pill placeholders (fetch not yet fired — deferred)
    expect(screen.getByTestId('persona-status-skeleton')).toBeInTheDocument()
  })

  it('does not render when no channels exist', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ channels: [], threshold: 5 }),
    } as Response)

    const { container } = render(<PersonaStatus />, { wrapper: Wrapper })

    // Before defer: skeleton shows
    expect(screen.getByTestId('persona-status-skeleton')).toBeInTheDocument()

    await advanceDefer()

    // Component should not render at all (empty channels returns null)
    expect(container.firstChild).toBeNull()
  })

  it('renders section header with active and building counts', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        channels: [
          { channelName: 'Fireship', transcriptCount: 10, personaId: 1, personaCreatedAt: new Date() },
          { channelName: 'ThePrimeagen', transcriptCount: 8, personaId: 2, personaCreatedAt: new Date() },
          { channelName: 'Theo', transcriptCount: 3, personaId: null, personaCreatedAt: null },
        ],
        threshold: 5,
      }),
    } as Response)

    render(<PersonaStatus />, { wrapper: Wrapper })

    await advanceDefer()

    // Should show "2 active · 1 building"
    expect(screen.getByText(/Personas/i)).toBeInTheDocument()
    expect(screen.getByText(/2 active/i)).toBeInTheDocument()
    expect(screen.getByText(/1 building/i)).toBeInTheDocument()
  })

  it('renders active persona with checkmark badge', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        channels: [
          { channelName: 'Fireship', transcriptCount: 10, personaId: 1, personaCreatedAt: new Date() },
        ],
        threshold: 5,
      }),
    } as Response)

    render(<PersonaStatus />, { wrapper: Wrapper })

    await advanceDefer()

    expect(screen.getByText('@Fireship')).toBeInTheDocument()
    // Should show checkmark
    expect(screen.getByText('✓')).toBeInTheDocument()
  })

  it('renders ready-to-create channel with transcript count and Create button', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        channels: [
          { channelName: 'Theo', transcriptCount: 6, personaId: null, personaCreatedAt: null },
        ],
        threshold: 5,
      }),
    } as Response)

    render(<PersonaStatus />, { wrapper: Wrapper })

    await advanceDefer()

    expect(screen.getByText('@Theo')).toBeInTheDocument()
    // Should show transcript count
    expect(screen.getByText(/6 transcripts/i)).toBeInTheDocument()
    // Should show Create button
    expect(screen.getByRole('button', { name: /create/i })).toBeInTheDocument()
  })

  it('renders building channel with progress bar and "more needed" text', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        channels: [
          { channelName: 'Web Dev Simplified', transcriptCount: 2, personaId: null, personaCreatedAt: null },
        ],
        threshold: 5,
      }),
    } as Response)

    render(<PersonaStatus />, { wrapper: Wrapper })

    await advanceDefer()

    expect(screen.getByText('@Web Dev Simplified')).toBeInTheDocument()
    // Should show progress (2/5)
    expect(screen.getByText('2/5')).toBeInTheDocument()
    // Should show "3 more needed"
    expect(screen.getByText(/3 more needed/i)).toBeInTheDocument()
    // Should have a progress bar
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
  })

  it('renders mix of active, ready, and building channels', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        channels: [
          { channelName: 'Fireship', transcriptCount: 10, personaId: 1, personaCreatedAt: new Date() },
          { channelName: 'Theo', transcriptCount: 6, personaId: null, personaCreatedAt: null },
          { channelName: 'Web Dev Simplified', transcriptCount: 2, personaId: null, personaCreatedAt: null },
        ],
        threshold: 5,
      }),
    } as Response)

    render(<PersonaStatus />, { wrapper: Wrapper })

    await advanceDefer()

    // Active persona with checkmark
    expect(screen.getByText('@Fireship')).toBeInTheDocument()
    expect(screen.getByText('✓')).toBeInTheDocument()

    // Ready to create with Create button
    expect(screen.getByText('@Theo')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /create/i })).toBeInTheDocument()

    // Building with progress
    expect(screen.getByText('@Web Dev Simplified')).toBeInTheDocument()
    expect(screen.getByText('2/5')).toBeInTheDocument()
  })

  it('calls POST /api/personas when Create button is clicked', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          channels: [
            { channelName: 'Theo', transcriptCount: 6, personaId: null, personaCreatedAt: null },
          ],
          threshold: 5,
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      } as Response)

    render(<PersonaStatus />, { wrapper: Wrapper })

    await advanceDefer()

    const createButton = screen.getByRole('button', { name: /create/i })

    // Click and drain all async microtasks
    await act(async () => {
      createButton.click()
    })

    expect(fetch).toHaveBeenCalledWith('/api/personas', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ channelName: 'Theo' }),
    })
  })

  it('updates card to active state after successful persona creation', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          channels: [
            { channelName: 'Theo', transcriptCount: 6, personaId: null, personaCreatedAt: null },
          ],
          threshold: 5,
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ persona: { id: 42 } }),
      } as Response)

    render(<PersonaStatus />, { wrapper: Wrapper })

    await advanceDefer()

    const createButton = screen.getByRole('button', { name: /create/i })

    // Click and drain all async microtasks
    await act(async () => {
      createButton.click()
    })

    // After creation, card should update to active state (checkmark)
    expect(screen.getByText('✓')).toBeInTheDocument()

    // Create button should be gone
    expect(screen.queryByRole('button', { name: /create/i })).not.toBeInTheDocument()
  })

  it('shows loading state on Create button while creating', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          channels: [
            { channelName: 'Theo', transcriptCount: 6, personaId: null, personaCreatedAt: null },
          ],
          threshold: 5,
        }),
      } as Response)
      .mockImplementationOnce(() => new Promise(() => {})) // Never resolves

    render(<PersonaStatus />, { wrapper: Wrapper })

    await advanceDefer()

    const createButton = screen.getByRole('button', { name: /create/i })

    // Click — the second fetch never resolves, so loading state persists
    await act(async () => {
      createButton.click()
    })

    // Button should show loading state
    expect(screen.getByText(/creating/i)).toBeInTheDocument()
  })

  it('shows error message when persona creation fails', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          channels: [
            { channelName: 'Theo', transcriptCount: 6, personaId: null, personaCreatedAt: null },
          ],
          threshold: 5,
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Failed to create persona' }),
      } as Response)

    render(<PersonaStatus />, { wrapper: Wrapper })

    await advanceDefer()

    const createButton = screen.getByRole('button', { name: /create/i })

    // Click and drain all async microtasks
    await act(async () => {
      createButton.click()
    })

    // Error message should appear
    expect(screen.getByText(/failed to create persona/i)).toBeInTheDocument()
  })

  it('passes hasActivePersonas prop to callback when personas exist', async () => {
    const onActivePersonasChange = vi.fn()

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        channels: [
          { channelName: 'Fireship', transcriptCount: 10, personaId: 1, personaCreatedAt: new Date() },
        ],
        threshold: 5,
      }),
    } as Response)

    render(<PersonaStatus onActivePersonasChange={onActivePersonasChange} />, { wrapper: Wrapper })

    await advanceDefer()

    expect(onActivePersonasChange).toHaveBeenCalledWith(true)
  })

  it('calls callback with false when no active personas exist', async () => {
    const onActivePersonasChange = vi.fn()

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        channels: [
          { channelName: 'Theo', transcriptCount: 3, personaId: null, personaCreatedAt: null },
        ],
        threshold: 5,
      }),
    } as Response)

    render(<PersonaStatus onActivePersonasChange={onActivePersonasChange} />, { wrapper: Wrapper })

    await advanceDefer()

    expect(onActivePersonasChange).toHaveBeenCalledWith(false)
  })

  it('limits visible channels to 5 by default when more than 5 exist', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        channels: [
          { channelName: 'Channel1', transcriptCount: 10, personaId: 1, personaCreatedAt: new Date() },
          { channelName: 'Channel2', transcriptCount: 10, personaId: 2, personaCreatedAt: new Date() },
          { channelName: 'Channel3', transcriptCount: 9, personaId: null, personaCreatedAt: null },
          { channelName: 'Channel4', transcriptCount: 8, personaId: null, personaCreatedAt: null },
          { channelName: 'Channel5', transcriptCount: 7, personaId: null, personaCreatedAt: null },
          { channelName: 'Channel6', transcriptCount: 6, personaId: null, personaCreatedAt: null },
          { channelName: 'Channel7', transcriptCount: 5, personaId: null, personaCreatedAt: null },
        ],
        threshold: 5,
      }),
    } as Response)

    render(<PersonaStatus />, { wrapper: Wrapper })

    await advanceDefer()

    // First 5 should be visible
    expect(screen.getByText('@Channel1')).toBeInTheDocument()
    expect(screen.getByText('@Channel2')).toBeInTheDocument()
    expect(screen.getByText('@Channel3')).toBeInTheDocument()
    expect(screen.getByText('@Channel4')).toBeInTheDocument()
    expect(screen.getByText('@Channel5')).toBeInTheDocument()

    // Last 2 should be hidden
    expect(screen.queryByText('@Channel6')).not.toBeInTheDocument()
    expect(screen.queryByText('@Channel7')).not.toBeInTheDocument()
  })

  it('shows "Show all N channels" button when more than 5 channels exist', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        channels: [
          { channelName: 'Channel1', transcriptCount: 10, personaId: 1, personaCreatedAt: new Date() },
          { channelName: 'Channel2', transcriptCount: 9, personaId: null, personaCreatedAt: null },
          { channelName: 'Channel3', transcriptCount: 8, personaId: null, personaCreatedAt: null },
          { channelName: 'Channel4', transcriptCount: 7, personaId: null, personaCreatedAt: null },
          { channelName: 'Channel5', transcriptCount: 6, personaId: null, personaCreatedAt: null },
          { channelName: 'Channel6', transcriptCount: 5, personaId: null, personaCreatedAt: null },
        ],
        threshold: 5,
      }),
    } as Response)

    render(<PersonaStatus />, { wrapper: Wrapper })

    await advanceDefer()

    expect(screen.getByText(/show all 6 channels/i)).toBeInTheDocument()
  })

  it('does not show toggle button when 5 or fewer channels exist', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        channels: [
          { channelName: 'Channel1', transcriptCount: 10, personaId: 1, personaCreatedAt: new Date() },
          { channelName: 'Channel2', transcriptCount: 9, personaId: null, personaCreatedAt: null },
          { channelName: 'Channel3', transcriptCount: 8, personaId: null, personaCreatedAt: null },
        ],
        threshold: 5,
      }),
    } as Response)

    render(<PersonaStatus />, { wrapper: Wrapper })

    await advanceDefer()

    expect(screen.getByText('@Channel1')).toBeInTheDocument()
    // Toggle button should not be present
    expect(screen.queryByText(/show all/i)).not.toBeInTheDocument()
  })

  it('expands to show all channels when toggle button is clicked', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        channels: [
          { channelName: 'Channel1', transcriptCount: 10, personaId: 1, personaCreatedAt: new Date() },
          { channelName: 'Channel2', transcriptCount: 9, personaId: null, personaCreatedAt: null },
          { channelName: 'Channel3', transcriptCount: 8, personaId: null, personaCreatedAt: null },
          { channelName: 'Channel4', transcriptCount: 7, personaId: null, personaCreatedAt: null },
          { channelName: 'Channel5', transcriptCount: 6, personaId: null, personaCreatedAt: null },
          { channelName: 'Channel6', transcriptCount: 5, personaId: null, personaCreatedAt: null },
        ],
        threshold: 5,
      }),
    } as Response)

    render(<PersonaStatus />, { wrapper: Wrapper })

    await advanceDefer()

    expect(screen.getByText(/show all 6 channels/i)).toBeInTheDocument()

    const toggleButton = screen.getByRole('button', { name: /show all 6 channels/i })
    await act(async () => {
      toggleButton.click()
    })

    // All channels should now be visible
    expect(screen.getByText('@Channel6')).toBeInTheDocument()
    // Button text should change to "Show less"
    expect(screen.getByText(/show less/i)).toBeInTheDocument()
  })

  it('collapses back to 5 channels when "Show less" is clicked', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        channels: [
          { channelName: 'Channel1', transcriptCount: 10, personaId: 1, personaCreatedAt: new Date() },
          { channelName: 'Channel2', transcriptCount: 9, personaId: null, personaCreatedAt: null },
          { channelName: 'Channel3', transcriptCount: 8, personaId: null, personaCreatedAt: null },
          { channelName: 'Channel4', transcriptCount: 7, personaId: null, personaCreatedAt: null },
          { channelName: 'Channel5', transcriptCount: 6, personaId: null, personaCreatedAt: null },
          { channelName: 'Channel6', transcriptCount: 5, personaId: null, personaCreatedAt: null },
        ],
        threshold: 5,
      }),
    } as Response)

    render(<PersonaStatus />, { wrapper: Wrapper })

    await advanceDefer()

    expect(screen.getByText(/show all 6 channels/i)).toBeInTheDocument()

    // Expand
    const toggleButton = screen.getByRole('button', { name: /show all 6 channels/i })
    await act(async () => {
      toggleButton.click()
    })

    expect(screen.getByText(/show less/i)).toBeInTheDocument()
    expect(screen.getByText('@Channel6')).toBeInTheDocument()

    // Collapse
    const collapseButton = screen.getByRole('button', { name: /show less/i })
    await act(async () => {
      collapseButton.click()
    })

    // Last channel should be hidden again
    expect(screen.queryByText('@Channel6')).not.toBeInTheDocument()

    // Button should show "Show all" again
    expect(screen.getByText(/show all 6 channels/i)).toBeInTheDocument()
  })

  it('sorts channels with active first, then ready, then building by transcript count', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        channels: [
          // Intentionally unsorted to test sorting logic
          { channelName: 'Building1', transcriptCount: 2, personaId: null, personaCreatedAt: null },
          { channelName: 'Active2', transcriptCount: 15, personaId: 2, personaCreatedAt: new Date() },
          { channelName: 'Ready1', transcriptCount: 8, personaId: null, personaCreatedAt: null },
          { channelName: 'Active1', transcriptCount: 20, personaId: 1, personaCreatedAt: new Date() },
          { channelName: 'Building2', transcriptCount: 4, personaId: null, personaCreatedAt: null },
          { channelName: 'Ready2', transcriptCount: 6, personaId: null, personaCreatedAt: null },
        ],
        threshold: 5,
      }),
    } as Response)

    render(<PersonaStatus />, { wrapper: Wrapper })

    await advanceDefer()

    expect(screen.getByText('@Active1')).toBeInTheDocument()

    const channels = screen.getAllByText(/@\w+/)

    // Expected order: Active1 (20), Active2 (15), Ready1 (8), Ready2 (6), Building2 (4)
    expect(channels[0]).toHaveTextContent('@Active1')
    expect(channels[1]).toHaveTextContent('@Active2')
    expect(channels[2]).toHaveTextContent('@Ready1')
    expect(channels[3]).toHaveTextContent('@Ready2')
    expect(channels[4]).toHaveTextContent('@Building2')

    // Building1 (2) should be hidden (6th item, only 5 visible)
    expect(screen.queryByText('@Building1')).not.toBeInTheDocument()
  })

  it('always shows all active personas even when more than 5 channels exist', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        channels: [
          { channelName: 'Active1', transcriptCount: 20, personaId: 1, personaCreatedAt: new Date() },
          { channelName: 'Active2', transcriptCount: 19, personaId: 2, personaCreatedAt: new Date() },
          { channelName: 'Active3', transcriptCount: 18, personaId: 3, personaCreatedAt: new Date() },
          { channelName: 'Active4', transcriptCount: 17, personaId: 4, personaCreatedAt: new Date() },
          { channelName: 'Active5', transcriptCount: 16, personaId: 5, personaCreatedAt: new Date() },
          { channelName: 'Active6', transcriptCount: 15, personaId: 6, personaCreatedAt: new Date() },
          { channelName: 'Ready1', transcriptCount: 10, personaId: null, personaCreatedAt: null },
        ],
        threshold: 5,
      }),
    } as Response)

    render(<PersonaStatus />, { wrapper: Wrapper })

    await advanceDefer()

    // All 6 active personas should be visible (even though default is 5)
    expect(screen.getByText('@Active1')).toBeInTheDocument()
    expect(screen.getByText('@Active2')).toBeInTheDocument()
    expect(screen.getByText('@Active3')).toBeInTheDocument()
    expect(screen.getByText('@Active4')).toBeInTheDocument()
    expect(screen.getByText('@Active5')).toBeInTheDocument()
    expect(screen.getByText('@Active6')).toBeInTheDocument()

    // Ready1 should be hidden (7th item)
    expect(screen.queryByText('@Ready1')).not.toBeInTheDocument()

    // Toggle button should still exist and show correct count
    expect(screen.getByText(/show all 7 channels/i)).toBeInTheDocument()
  })

  describe('PersonaStatusSkeleton', () => {
    it('renders skeleton with data-testid', () => {
      render(<PersonaStatusSkeleton />)
      expect(screen.getByTestId('persona-status-skeleton')).toBeInTheDocument()
    })

    it('renders 4 pill-shaped placeholders', () => {
      const { container } = render(<PersonaStatusSkeleton />)
      const pills = container.querySelectorAll('.rounded-full.animate-pulse')
      expect(pills).toHaveLength(4)
    })

    it('renders pill placeholders with h-8 height', () => {
      const { container } = render(<PersonaStatusSkeleton />)
      const pills = container.querySelectorAll('.rounded-full.animate-pulse')
      pills.forEach(pill => {
        expect(pill).toHaveClass('h-8')
      })
    })

    it('renders a label placeholder row above the pills', () => {
      const { container } = render(<PersonaStatusSkeleton />)
      // The label row has two small rectangular placeholders
      const labelRow = container.querySelector('.flex.items-center.gap-2')
      expect(labelRow).toBeInTheDocument()
      const labelPlaceholders = labelRow?.querySelectorAll('.animate-pulse')
      expect(labelPlaceholders?.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('Chat button (Chunk 4)', () => {
    it('shows Chat button on active persona cards', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          channels: [
            {
              channelName: 'Fireship',
              transcriptCount: 10,
              personaId: 1,
              personaCreatedAt: new Date(),
              personaName: 'The Fireship Persona',
              expertiseTopics: ['web dev', 'JavaScript'],
            },
          ],
          threshold: 5,
        }),
      } as Response)

      render(<PersonaStatus />, { wrapper: Wrapper })

      await advanceDefer()

      const chatBtn = screen.getByTestId('chat-btn-Fireship')
      expect(chatBtn).toBeInTheDocument()
      expect(chatBtn).toHaveAttribute('aria-label', 'Chat with The Fireship Persona')
    })

    it('does not show Chat button on non-active (building/ready) cards', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          channels: [
            {
              channelName: 'Theo',
              transcriptCount: 6,
              personaId: null,
              personaCreatedAt: null,
              personaName: null,
              expertiseTopics: null,
            },
          ],
          threshold: 5,
        }),
      } as Response)

      render(<PersonaStatus />, { wrapper: Wrapper })

      await advanceDefer()

      expect(screen.queryByTestId('chat-btn-Theo')).not.toBeInTheDocument()
    })

    it('uses channelName as fallback when personaName is null', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          channels: [
            {
              channelName: 'Fireship',
              transcriptCount: 10,
              personaId: 1,
              personaCreatedAt: new Date(),
              personaName: null,
              expertiseTopics: null,
            },
          ],
          threshold: 5,
        }),
      } as Response)

      render(<PersonaStatus />, { wrapper: Wrapper })

      await advanceDefer()

      const chatBtn = screen.getByTestId('chat-btn-Fireship')
      expect(chatBtn).toHaveAttribute('aria-label', 'Chat with Fireship')
    })
  })

  describe('Uniform pill sizing (Chunk 2)', () => {
    it('applies min-width and max-width constraints to active persona pills', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          channels: [
            { channelName: 'Fireship', transcriptCount: 10, personaId: 1, personaCreatedAt: new Date() },
          ],
          threshold: 5,
        }),
      } as Response)

      const { container } = render(<PersonaStatus />, { wrapper: Wrapper })

      await advanceDefer()

      expect(screen.getByText('@Fireship')).toBeInTheDocument()

      // Find the pill container
      const pill = container.querySelector('.rounded-full.bg-green-500\\/10')
      expect(pill).toBeInTheDocument()
      expect(pill).toHaveClass('min-w-[160px]')
      expect(pill).toHaveClass('max-w-[280px]')
    })

    it('applies min-width and max-width constraints to ready-to-create pills', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          channels: [
            { channelName: 'Theo', transcriptCount: 6, personaId: null, personaCreatedAt: null },
          ],
          threshold: 5,
        }),
      } as Response)

      render(<PersonaStatus />, { wrapper: Wrapper })

      await advanceDefer()

      expect(screen.getByText('@Theo')).toBeInTheDocument()

      // Find the ready pill container (has Create button)
      const pill = screen.getByRole('button', { name: /create/i }).closest('.rounded-lg')
      expect(pill).toBeInTheDocument()
      expect(pill).toHaveClass('min-w-[160px]')
      expect(pill).toHaveClass('max-w-[280px]')
    })

    it('applies min-width and max-width constraints to building pills', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          channels: [
            { channelName: 'Web Dev Simplified', transcriptCount: 2, personaId: null, personaCreatedAt: null },
          ],
          threshold: 5,
        }),
      } as Response)

      render(<PersonaStatus />, { wrapper: Wrapper })

      await advanceDefer()

      expect(screen.getByText('@Web Dev Simplified')).toBeInTheDocument()

      // Find the building pill container (has progress bar)
      const pill = screen.getByRole('progressbar').closest('.rounded-lg')
      expect(pill).toBeInTheDocument()
      expect(pill).toHaveClass('min-w-[160px]')
      expect(pill).toHaveClass('max-w-[280px]')
    })

    it('truncates long channel names with ellipsis and provides title attribute', async () => {
      const longChannelName = 'AI News & Strategy Daily | Nate B Jones'
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          channels: [
            { channelName: longChannelName, transcriptCount: 10, personaId: 1, personaCreatedAt: new Date() },
          ],
          threshold: 5,
        }),
      } as Response)

      render(<PersonaStatus />, { wrapper: Wrapper })

      await advanceDefer()

      expect(screen.getByText(`@${longChannelName}`)).toBeInTheDocument()

      // Find the channel name span
      const channelNameSpan = screen.getByText(`@${longChannelName}`)
      expect(channelNameSpan).toHaveClass('truncate')
      expect(channelNameSpan).toHaveAttribute('title', longChannelName)
    })

    it('applies transition classes to pills container for smooth expand/collapse', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          channels: [
            { channelName: 'Channel1', transcriptCount: 10, personaId: 1, personaCreatedAt: new Date() },
            { channelName: 'Channel2', transcriptCount: 9, personaId: null, personaCreatedAt: null },
          ],
          threshold: 5,
        }),
      } as Response)

      const { container } = render(<PersonaStatus />, { wrapper: Wrapper })

      await advanceDefer()

      expect(screen.getByText('@Channel1')).toBeInTheDocument()

      // Find the pills container (flex flex-wrap gap-2)
      const pillsContainer = container.querySelector('.flex.flex-wrap.gap-2')
      expect(pillsContainer).toBeInTheDocument()
      expect(pillsContainer).toHaveClass('transition-all')
      expect(pillsContainer).toHaveClass('duration-200')
    })

    it('truncates channel names in ready-to-create pills', async () => {
      const longChannelName = 'Very Long Channel Name That Should Be Truncated'
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          channels: [
            { channelName: longChannelName, transcriptCount: 6, personaId: null, personaCreatedAt: null },
          ],
          threshold: 5,
        }),
      } as Response)

      render(<PersonaStatus />, { wrapper: Wrapper })

      await advanceDefer()

      expect(screen.getByText(`@${longChannelName}`)).toBeInTheDocument()

      const channelNameSpan = screen.getByText(`@${longChannelName}`)
      expect(channelNameSpan).toHaveClass('truncate')
      expect(channelNameSpan).toHaveAttribute('title', longChannelName)
    })

    it('truncates channel names in building pills', async () => {
      const longChannelName = 'Another Very Long Channel Name For Testing'
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          channels: [
            { channelName: longChannelName, transcriptCount: 2, personaId: null, personaCreatedAt: null },
          ],
          threshold: 5,
        }),
      } as Response)

      render(<PersonaStatus />, { wrapper: Wrapper })

      await advanceDefer()

      expect(screen.getByText(`@${longChannelName}`)).toBeInTheDocument()

      const channelNameSpan = screen.getByText(`@${longChannelName}`)
      expect(channelNameSpan).toHaveClass('truncate')
      expect(channelNameSpan).toHaveAttribute('title', longChannelName)
    })
  })
})
