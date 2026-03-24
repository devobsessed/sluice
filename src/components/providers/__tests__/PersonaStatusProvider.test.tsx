import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { PersonaStatusProvider, usePersonaStatus } from '../PersonaStatusProvider'

const mockFetch = vi.fn()
global.fetch = mockFetch

describe('PersonaStatusProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function advanceDefer() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })
  }

  it('throws when used outside provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => renderHook(() => usePersonaStatus())).toThrow(
      'usePersonaStatus must be used within a PersonaStatusProvider'
    )
    spy.mockRestore()
  })

  it('starts with isLoading=true and empty channels', () => {
    mockFetch.mockReturnValue(new Promise(() => {}))
    const { result } = renderHook(() => usePersonaStatus(), {
      wrapper: PersonaStatusProvider,
    })
    expect(result.current.isLoading).toBe(true)
    expect(result.current.channels).toEqual([])
    expect(result.current.threshold).toBe(5)
  })

  it('fetches /api/personas/status after 1.5s delay', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ channels: [], threshold: 5 }),
    })

    renderHook(() => usePersonaStatus(), {
      wrapper: PersonaStatusProvider,
    })

    // Should NOT have fetched yet
    expect(mockFetch).not.toHaveBeenCalled()

    await advanceDefer()

    expect(mockFetch).toHaveBeenCalledWith('/api/personas/status')
  })

  it('populates channels from API response', async () => {
    const mockChannels = [
      {
        channelName: 'Fireship',
        transcriptCount: 10,
        personaId: 1,
        personaCreatedAt: '2026-01-01',
        personaName: 'Fireship',
        expertiseTopics: ['React'],
      },
    ]
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ channels: mockChannels, threshold: 5 }),
    })

    const { result } = renderHook(() => usePersonaStatus(), {
      wrapper: PersonaStatusProvider,
    })

    await advanceDefer()

    expect(result.current.channels).toEqual(mockChannels)
    expect(result.current.isLoading).toBe(false)
  })

  it('updateChannel modifies a channel in place', async () => {
    mockFetch.mockResolvedValueOnce({
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
    })

    const { result } = renderHook(() => usePersonaStatus(), {
      wrapper: PersonaStatusProvider,
    })

    await advanceDefer()

    act(() => {
      result.current.updateChannel('Theo', { personaId: 42, personaCreatedAt: '2026-03-24' })
    })

    expect(result.current.channels[0]?.personaId).toBe(42)
  })

  it('handles fetch failure gracefully', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'))

    const { result } = renderHook(() => usePersonaStatus(), {
      wrapper: PersonaStatusProvider,
    })

    await advanceDefer()

    expect(result.current.isLoading).toBe(false)
    expect(result.current.channels).toEqual([])
  })

  it('handles non-ok response gracefully', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false })

    const { result } = renderHook(() => usePersonaStatus(), {
      wrapper: PersonaStatusProvider,
    })

    await advanceDefer()

    expect(result.current.isLoading).toBe(false)
    expect(result.current.channels).toEqual([])
  })

  it('refetch re-fetches data', async () => {
    const firstChannels = [
      {
        channelName: 'Fireship',
        transcriptCount: 5,
        personaId: null,
        personaCreatedAt: null,
        personaName: null,
        expertiseTopics: null,
      },
    ]
    const secondChannels = [
      {
        channelName: 'Fireship',
        transcriptCount: 35,
        personaId: 1,
        personaCreatedAt: '2026-03-24',
        personaName: 'Fireship AI',
        expertiseTopics: ['React', 'TypeScript'],
      },
    ]

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ channels: firstChannels, threshold: 5 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ channels: secondChannels, threshold: 5 }),
      })

    const { result } = renderHook(() => usePersonaStatus(), {
      wrapper: PersonaStatusProvider,
    })

    await advanceDefer()

    expect(result.current.channels).toEqual(firstChannels)

    await act(async () => {
      await result.current.refetch()
    })

    expect(result.current.channels).toEqual(secondChannels)
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })
})
