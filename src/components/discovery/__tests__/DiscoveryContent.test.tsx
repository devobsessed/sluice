import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
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

describe('DiscoveryContent', () => {
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
})
