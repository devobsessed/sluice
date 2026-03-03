import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Mock auth-client — must include oauth2.consent
const mockUseSession = vi.fn()
const mockSignOut = vi.fn()
const mockConsent = vi.fn()

vi.mock('@/lib/auth-client', () => ({
  authClient: {
    oauth2: {
      consent: (...args: unknown[]) => mockConsent(...args),
    },
  },
  useSession: () => mockUseSession(),
  signOut: (...args: unknown[]) => mockSignOut(...args),
}))

// Mock next/navigation
const mockSearchParams = new URLSearchParams()
vi.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
  useRouter: () => ({ push: vi.fn() }),
}))

// Mock fetch for client lookup
const mockFetch = vi.fn()
global.fetch = mockFetch

import ConsentPage from '../page'

describe('ConsentPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSearchParams.delete('client_id')
    mockSearchParams.delete('scope')
    mockFetch.mockResolvedValue({
      json: () => Promise.resolve({ data: { name: 'Claude Desktop', icon: null, uri: null } }),
    })
  })

  describe('loading state', () => {
    it('shows spinner while session is pending', () => {
      mockUseSession.mockReturnValue({ data: null, isPending: true })
      render(<ConsentPage />)
      expect(document.querySelector('.animate-spin')).toBeInTheDocument()
    })
  })

  describe('authenticated with consent params', () => {
    beforeEach(() => {
      mockUseSession.mockReturnValue({
        data: { user: { email: 'darin@devobsessed.com' } },
        isPending: false,
      })
      mockSearchParams.set('client_id', 'test-client')
      mockSearchParams.set('scope', 'openid profile email')
    })

    it('displays client name from API lookup', async () => {
      render(<ConsentPage />)
      await waitFor(() => {
        expect(screen.getByText('Claude Desktop')).toBeInTheDocument()
      })
    })

    it('displays "An application" when client has no name', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ data: { name: null, icon: null, uri: null } }),
      })
      render(<ConsentPage />)
      await waitFor(() => {
        expect(screen.getByText('An application')).toBeInTheDocument()
      })
    })

    it('displays human-readable scope labels', async () => {
      render(<ConsentPage />)
      await waitFor(() => {
        expect(screen.getByText('Verify your identity')).toBeInTheDocument()
        expect(screen.getByText('View your profile')).toBeInTheDocument()
        expect(screen.getByText('View your email address')).toBeInTheDocument()
      })
    })

    it('displays "wants access to your Sluice data" subtitle', async () => {
      render(<ConsentPage />)
      await waitFor(() => {
        expect(screen.getByText('wants access to your Sluice data')).toBeInTheDocument()
      })
    })

    it('shows signed-in-as footer with user email', async () => {
      render(<ConsentPage />)
      await waitFor(() => {
        expect(screen.getByText(/Signed in as darin@devobsessed.com/)).toBeInTheDocument()
      })
    })

    it('calls oauth2.consent with accept: true on Allow click', async () => {
      mockConsent.mockResolvedValue({})
      const user = userEvent.setup()
      render(<ConsentPage />)
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /allow access/i })).toBeInTheDocument()
      })
      await user.click(screen.getByRole('button', { name: /allow access/i }))
      expect(mockConsent).toHaveBeenCalledWith({ accept: true })
    })

    it('shows success state after Allow', async () => {
      mockConsent.mockResolvedValue({})
      const user = userEvent.setup()
      render(<ConsentPage />)
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /allow access/i })).toBeInTheDocument()
      })
      await user.click(screen.getByRole('button', { name: /allow access/i }))
      await waitFor(() => {
        expect(screen.getByText('Access granted')).toBeInTheDocument()
      })
    })

    it('calls oauth2.consent with accept: false on Deny click', async () => {
      mockConsent.mockResolvedValue({})
      const user = userEvent.setup()
      render(<ConsentPage />)
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /deny/i })).toBeInTheDocument()
      })
      await user.click(screen.getByRole('button', { name: /deny/i }))
      expect(mockConsent).toHaveBeenCalledWith({ accept: false })
    })

    it('shows error on consent failure', async () => {
      mockConsent.mockRejectedValue(new Error('Network error'))
      const user = userEvent.setup()
      render(<ConsentPage />)
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /allow access/i })).toBeInTheDocument()
      })
      await user.click(screen.getByRole('button', { name: /allow access/i }))
      await waitFor(() => {
        expect(screen.getByText(/something went wrong/i)).toBeInTheDocument()
      })
    })

    it('disables buttons while submitting', async () => {
      mockConsent.mockReturnValue(new Promise(() => {})) // never resolves
      const user = userEvent.setup()
      render(<ConsentPage />)
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /allow access/i })).toBeInTheDocument()
      })
      await user.click(screen.getByRole('button', { name: /allow access/i }))
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /deny/i })).toBeDisabled()
      })
    })
  })
})
