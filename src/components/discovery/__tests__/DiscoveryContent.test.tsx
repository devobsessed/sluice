import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DiscoveryContent } from '../DiscoveryContent'

// Mock Next.js navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
  usePathname: () => '/discovery',
  useSearchParams: () => ({
    toString: () => '',
    get: () => null,
  }),
}))

vi.mock('@/components/layout/PageTitleContext', () => ({
  usePageTitle: () => ({ setPageTitle: vi.fn() }),
}))

global.fetch = vi.fn()

// Integration tests for DiscoveryContent live in src/app/discovery/__tests__/page.test.tsx
// These colocated tests cover basic rendering behavior

const mockChannel = {
  id: 42,
  channelId: 'UC_fireship',
  name: 'Fireship',
  thumbnailUrl: null,
  feedUrl: null,
  autoFetch: null,
  lastFetchedAt: null,
  fetchIntervalHours: null,
  createdAt: new Date('2024-01-01').toISOString(),
}

const successResponse = { channels: [mockChannel], videos: [] }

describe('DiscoveryContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render empty state when no channels are followed', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ channels: [], videos: [] }),
    })

    render(<DiscoveryContent />)

    await waitFor(() => {
      expect(screen.getByText(/no channels followed yet/i)).toBeInTheDocument()
    })
  })

  it('should show loading skeleton initially', () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () => new Promise(() => {}),
    )

    render(<DiscoveryContent />)

    const skeletons = screen.getAllByTestId('discovery-video-card-skeleton')
    expect(skeletons.length).toBeGreaterThan(0)
  })

  describe('handleUnfollow', () => {
    it('calls DELETE /api/channels/:id and refreshes data on unfollow', async () => {
      const user = userEvent.setup()
      vi.spyOn(window, 'confirm').mockReturnValue(true)

      const fetchMock = global.fetch as ReturnType<typeof vi.fn>
      // Initial load
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => successResponse,
      })
      // DELETE call
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      // Refresh after unfollow
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ channels: [], videos: [] }),
      })

      render(<DiscoveryContent />)

      // Wait for the channel filter dropdown to appear (channels loaded)
      // The trigger shows "All Channels" when no channel is pre-selected
      await waitFor(() => {
        expect(screen.getByText('All Channels')).toBeInTheDocument()
      })

      // Open the channel filter dropdown
      await user.click(screen.getByText('All Channels'))

      // Click the unfollow X button for Fireship
      const xButton = await screen.findByRole('button', { name: /unfollow fireship/i })
      await user.click(xButton)

      // Verify DELETE was called with correct channel id
      const deleteCalls = fetchMock.mock.calls.filter((args: unknown[]) => {
        const url = args[0]
        const opts = args[1] as RequestInit | undefined
        return typeof url === 'string' && url.includes('/api/channels/42') && opts?.method === 'DELETE'
      })
      expect(deleteCalls).toHaveLength(1)
    })

    it('refreshes discovery data after a successful unfollow', async () => {
      const user = userEvent.setup()
      vi.spyOn(window, 'confirm').mockReturnValue(true)

      const fetchMock = global.fetch as ReturnType<typeof vi.fn>
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => successResponse,
      })
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ channels: [], videos: [] }),
      })

      render(<DiscoveryContent />)

      // Wait for the channel filter dropdown to appear (channels loaded)
      await waitFor(() => {
        expect(screen.getByText('All Channels')).toBeInTheDocument()
      })

      // Open the channel filter dropdown
      await user.click(screen.getByText('All Channels'))

      const xButton = await screen.findByRole('button', { name: /unfollow fireship/i })
      await user.click(xButton)

      // After refresh with empty channels, empty state should render
      await waitFor(() => {
        expect(screen.getByText(/no channels followed yet/i)).toBeInTheDocument()
      })
    })
  })
})
