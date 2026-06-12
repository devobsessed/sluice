import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PersonaActionsMenu } from '../PersonaActionsMenu'

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch

describe('PersonaActionsMenu', () => {
  beforeEach(() => {
    mockFetch.mockClear()
  })

  it('PersonaActionsMenu is a standalone component accepting personaId (extensible for story 4)', () => {
    // Verify the component renders and accepts the required props
    render(
      <PersonaActionsMenu
        personaId={1}
        personaName="Fireship"
      />
    )
    // The trigger button should be present
    expect(screen.getByRole('button', { name: /persona actions/i })).toBeInTheDocument()
  })

  it('header renders a dropdown menu with a Regenerate persona item', async () => {
    const user = userEvent.setup()
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ data: { id: 1 } }) })

    render(
      <PersonaActionsMenu
        personaId={1}
        personaName="Fireship"
      />
    )

    const trigger = screen.getByRole('button', { name: /persona actions/i })
    await user.click(trigger)

    // The dropdown item should appear
    expect(screen.getByRole('menuitem', { name: /regenerate persona/i })).toBeInTheDocument()
  })

  it('Regenerate item calls the regenerate endpoint and surfaces in-flight + result state', async () => {
    const user = userEvent.setup()

    // Use a delayed response to test in-flight state
    let resolveResponse!: (value: Response) => void
    const pendingResponse = new Promise<Response>((resolve) => {
      resolveResponse = resolve
    })
    mockFetch.mockReturnValue(pendingResponse)

    const onSuccess = vi.fn()
    render(
      <PersonaActionsMenu
        personaId={1}
        personaName="Fireship"
        onRegenSuccess={onSuccess}
      />
    )

    const trigger = screen.getByRole('button', { name: /persona actions/i })
    await user.click(trigger)

    const regenerateItem = screen.getByRole('menuitem', { name: /regenerate persona/i })
    await user.click(regenerateItem)

    // In-flight state: regenerating indicator visible
    expect(screen.getByText(/regenerating/i)).toBeInTheDocument()

    // Resolve the response
    resolveResponse(new Response(JSON.stringify({ data: { id: 1 } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalled()
    })

    // Verify the fetch was called with the correct endpoint
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/personas/1/regenerate',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('shows error state when regenerate call fails', async () => {
    const user = userEvent.setup()
    mockFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Regeneration failed' }),
    })

    render(
      <PersonaActionsMenu
        personaId={1}
        personaName="Fireship"
      />
    )

    const trigger = screen.getByRole('button', { name: /persona actions/i })
    await user.click(trigger)

    const regenerateItem = screen.getByRole('menuitem', { name: /regenerate persona/i })
    await user.click(regenerateItem)

    await waitFor(() => {
      expect(screen.getByText(/failed/i)).toBeInTheDocument()
    })
  })

  it('menu is keyboard-navigable', async () => {
    const user = userEvent.setup()
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ data: { id: 1 } }) })

    render(
      <PersonaActionsMenu
        personaId={1}
        personaName="Fireship"
      />
    )

    const trigger = screen.getByRole('button', { name: /persona actions/i })

    // Should be focusable
    trigger.focus()
    expect(document.activeElement).toBe(trigger)

    // Keyboard open
    await user.keyboard('{Enter}')

    // Menu item should be present and accessible
    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: /regenerate persona/i })).toBeInTheDocument()
    })
  })

  it('success state shows "Voice updated from N videos" using response transcriptCount', async () => {
    const user = userEvent.setup()
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ transcriptCount: 7, lastRegeneratedAt: '2026-06-10T12:00:00.000Z' }),
    })

    render(
      <PersonaActionsMenu
        personaId={1}
        personaName="Fireship"
      />
    )

    const trigger = screen.getByRole('button', { name: /persona actions/i })
    await user.click(trigger)

    const regenerateItem = screen.getByRole('menuitem', { name: /regenerate persona/i })
    await user.click(regenerateItem)

    await waitFor(() => {
      expect(screen.getByText(/Voice updated from 7 videos/i)).toBeInTheDocument()
    })
  })

  it('success state aria-live="polite" is present on the success span', async () => {
    const user = userEvent.setup()
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ transcriptCount: 3, lastRegeneratedAt: null }),
    })

    render(
      <PersonaActionsMenu
        personaId={1}
        personaName="Fireship"
      />
    )

    const trigger = screen.getByRole('button', { name: /persona actions/i })
    await user.click(trigger)

    const regenerateItem = screen.getByRole('menuitem', { name: /regenerate persona/i })
    await user.click(regenerateItem)

    await waitFor(() => {
      const successSpan = screen.getByText(/Voice updated from 3 videos/i)
      expect(successSpan).toHaveAttribute('aria-live', 'polite')
    })
  })

  it('last-updated indicator renders relative time when timestamp is provided', () => {
    // Two hours ago
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    render(
      <PersonaActionsMenu
        personaId={1}
        personaName="Fireship"
        lastRegeneratedAt={twoHoursAgo}
      />
    )
    // Should render something like "last updated 2h ago"
    expect(screen.getByText(/last updated/i)).toBeInTheDocument()
    expect(screen.getByText(/ago/i)).toBeInTheDocument()
  })

  it('last-updated indicator falls back gracefully when timestamp is null - no crash, no false "updated" claim', () => {
    // Should not throw, and should not render any "last updated" text
    render(
      <PersonaActionsMenu
        personaId={1}
        personaName="Fireship"
        lastRegeneratedAt={null}
      />
    )
    expect(screen.queryByText(/last updated/i)).not.toBeInTheDocument()
  })
})
