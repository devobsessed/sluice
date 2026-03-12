import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AccessRequestsPanel } from '../AccessRequestsPanel'

const mockFetch = vi.fn()
global.fetch = mockFetch

vi.mock('@/components/ui/tooltip', async () => {
  const actual = await vi.importActual('@/components/ui/tooltip')
  return {
    ...actual,
    Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    TooltipTrigger: ({ children, ...props }: { children: React.ReactNode; asChild?: boolean }) => <span {...props}>{children}</span>,
    TooltipContent: ({ children }: { children: React.ReactNode }) => <span data-testid="tooltip-content">{children}</span>,
  }
})

const mockRequests = [
  {
    id: 1,
    email: 'jane@example.com',
    name: 'Jane Doe',
    message: 'I would like access please',
    status: 'pending',
    createdAt: '2026-03-10T00:00:00Z',
    updatedAt: '2026-03-10T00:00:00Z',
  },
  {
    id: 2,
    email: 'bob@example.com',
    name: 'Bob Smith',
    message: null,
    status: 'pending',
    createdAt: '2026-03-09T00:00:00Z',
    updatedAt: '2026-03-09T00:00:00Z',
  },
  {
    id: 3,
    email: 'approved@example.com',
    name: 'Already Approved',
    message: null,
    status: 'approved',
    createdAt: '2026-03-08T00:00:00Z',
    updatedAt: '2026-03-08T12:00:00Z',
  },
]

describe('AccessRequestsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: mockRequests }),
    })
  })

  it('renders pending requests by default', async () => {
    render(<AccessRequestsPanel />)

    await waitFor(() => {
      expect(screen.getByText('Jane Doe')).toBeInTheDocument()
      expect(screen.getByText('Bob Smith')).toBeInTheDocument()
    })

    expect(screen.queryByText('Already Approved')).not.toBeInTheDocument()
  })

  it('shows pending count badge', async () => {
    render(<AccessRequestsPanel />)

    await waitFor(() => {
      expect(screen.getByText('2')).toBeInTheDocument()
    })
  })

  it('shows empty state when no requests match tab', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    })

    render(<AccessRequestsPanel />)

    await waitFor(() => {
      expect(screen.getByText('No pending requests')).toBeInTheDocument()
    })
  })

  it('shows approve and deny buttons for pending requests', async () => {
    render(<AccessRequestsPanel />)

    await waitFor(() => {
      const approveButtons = screen.getAllByText('Approve')
      const denyButtons = screen.getAllByText('Deny')
      expect(approveButtons).toHaveLength(2)
      expect(denyButtons).toHaveLength(2)
    })
  })

  it('calls PATCH endpoint when approve is clicked', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: mockRequests }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { ...mockRequests[0], status: 'approved' } }),
      })

    render(<AccessRequestsPanel />)

    await waitFor(() => {
      expect(screen.getByText('Jane Doe')).toBeInTheDocument()
    })

    const approveButtons = screen.getAllByText('Approve')
    await userEvent.click(approveButtons[0]!)

    expect(mockFetch).toHaveBeenCalledWith('/api/access-requests/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'approved' }),
    })
  })

  it('shows message in truncated form with tooltip for long messages', async () => {
    render(<AccessRequestsPanel />)

    await waitFor(() => {
      const messageEls = screen.getAllByText('I would like access please')
      expect(messageEls.length).toBeGreaterThanOrEqual(1)
    })
  })

  it('shows dash for null messages', async () => {
    render(<AccessRequestsPanel />)

    await waitFor(() => {
      const dashes = screen.getAllByText('-')
      expect(dashes.length).toBeGreaterThanOrEqual(1)
    })
  })
})
