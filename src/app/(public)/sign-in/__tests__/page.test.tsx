import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Mock auth-client
const mockSignIn = { social: vi.fn() }
const mockSignOut = vi.fn()
const mockUseSession = vi.fn()

vi.mock('@/lib/auth-client', () => ({
  signIn: { social: (...args: unknown[]) => mockSignIn.social(...args) },
  signOut: (...args: unknown[]) => mockSignOut(...args),
  useSession: () => mockUseSession(),
}))

// Mock next/navigation
const mockSearchParams = new URLSearchParams()
vi.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
  useRouter: () => ({ push: vi.fn() }),
}))

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))

import SignInPage from '../page'

describe('SignInPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSearchParams.delete('callbackUrl')
  })

  describe('loading state', () => {
    it('shows loading text while session is pending', () => {
      mockUseSession.mockReturnValue({ data: null, isPending: true })
      render(<SignInPage />)
      expect(screen.getByText('Loading...')).toBeInTheDocument()
    })
  })

  describe('unauthenticated state', () => {
    beforeEach(() => {
      mockUseSession.mockReturnValue({ data: null, isPending: false })
    })

    it('renders Sluice branding and description', () => {
      render(<SignInPage />)
      expect(screen.getByText('Sluice')).toBeInTheDocument()
      expect(screen.getByText(/extract knowledge from youtube/i)).toBeInTheDocument()
    })

    it('renders feature highlights', () => {
      render(<SignInPage />)
      expect(screen.getByText('Hybrid Search')).toBeInTheDocument()
      expect(screen.getByText('AI Insights')).toBeInTheDocument()
      expect(screen.getByText('Creator Personas')).toBeInTheDocument()
    })

    it('renders Sign in with Google button', () => {
      render(<SignInPage />)
      expect(screen.getByRole('button', { name: /sign in with google/i })).toBeInTheDocument()
    })

    it('calls signIn.social with google provider and default callbackURL on click', async () => {
      mockSignIn.social.mockResolvedValue({ error: null })
      const user = userEvent.setup()
      render(<SignInPage />)
      await user.click(screen.getByRole('button', { name: /sign in with google/i }))
      expect(mockSignIn.social).toHaveBeenCalledWith({
        provider: 'google',
        callbackURL: '/',
      })
    })

    it('uses callbackUrl from search params', async () => {
      mockSignIn.social.mockResolvedValue({ error: null })
      mockSearchParams.set('callbackUrl', '/discovery')
      const user = userEvent.setup()
      render(<SignInPage />)
      await user.click(screen.getByRole('button', { name: /sign in with google/i }))
      expect(mockSignIn.social).toHaveBeenCalledWith({
        provider: 'google',
        callbackURL: '/discovery',
      })
    })

    it('shows access restricted message with request access link on 403', async () => {
      mockSignIn.social.mockResolvedValue({
        error: { status: 403, message: 'Only @devobsessed.com accounts are allowed' },
      })
      const user = userEvent.setup()
      render(<SignInPage />)
      await user.click(screen.getByRole('button', { name: /sign in with google/i }))
      await waitFor(() => {
        expect(screen.getByText(/access restricted/i)).toBeInTheDocument()
      })
      const requestLink = screen.getByRole('link', { name: /request access/i })
      expect(requestLink).toHaveAttribute('href', '/request-access')
    })

    it('shows access restricted with request access link on 403 without message', async () => {
      mockSignIn.social.mockResolvedValue({
        error: { status: 403 },
      })
      const user = userEvent.setup()
      render(<SignInPage />)
      await user.click(screen.getByRole('button', { name: /sign in with google/i }))
      await waitFor(() => {
        expect(screen.getByText(/access restricted/i)).toBeInTheDocument()
      })
      expect(screen.getByRole('link', { name: /request access/i })).toBeInTheDocument()
    })

    it('shows generic error for non-403 errors', async () => {
      mockSignIn.social.mockResolvedValue({
        error: { status: 500, message: 'Internal server error' },
      })
      const user = userEvent.setup()
      render(<SignInPage />)
      await user.click(screen.getByRole('button', { name: /sign in with google/i }))
      await waitFor(() => {
        expect(screen.getByText('Internal server error')).toBeInTheDocument()
      })
    })

    it('does not show request access link for non-403 errors', async () => {
      mockSignIn.social.mockResolvedValue({
        error: { status: 500, message: 'Internal server error' },
      })
      const user = userEvent.setup()
      render(<SignInPage />)
      await user.click(screen.getByRole('button', { name: /sign in with google/i }))
      await waitFor(() => {
        expect(screen.getByText('Internal server error')).toBeInTheDocument()
      })
      expect(screen.queryByRole('link', { name: /request access/i })).not.toBeInTheDocument()
    })

    it('shows fallback error on exception', async () => {
      mockSignIn.social.mockRejectedValue(new Error('Connection failed'))
      const user = userEvent.setup()
      render(<SignInPage />)
      await user.click(screen.getByRole('button', { name: /sign in with google/i }))
      await waitFor(() => {
        expect(screen.getByText('Something went wrong. Please try again.')).toBeInTheDocument()
      })
    })

    it('disables button while loading', async () => {
      mockSignIn.social.mockReturnValue(new Promise(() => {}))
      const user = userEvent.setup()
      render(<SignInPage />)
      await user.click(screen.getByRole('button', { name: /sign in with google/i }))
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /redirecting/i })).toBeDisabled()
      })
    })
  })

  describe('authenticated state', () => {
    it('shows welcome back with user email', () => {
      mockUseSession.mockReturnValue({
        data: { user: { email: 'user@devobsessed.com', name: 'Test User' } },
        isPending: false,
      })
      render(<SignInPage />)
      expect(screen.getByText('Welcome back')).toBeInTheDocument()
      expect(screen.getByText('Signed in as user@devobsessed.com')).toBeInTheDocument()
    })

    it('shows link to Knowledge Bank', () => {
      mockUseSession.mockReturnValue({
        data: { user: { email: 'user@devobsessed.com', name: 'Test User' } },
        isPending: false,
      })
      render(<SignInPage />)
      const link = screen.getByRole('link', { name: /go to knowledge bank/i })
      expect(link).toHaveAttribute('href', '/')
    })

    it('does not show feature highlights when authenticated', () => {
      mockUseSession.mockReturnValue({
        data: { user: { email: 'user@devobsessed.com', name: 'Test User' } },
        isPending: false,
      })
      render(<SignInPage />)
      expect(screen.queryByText('Hybrid Search')).not.toBeInTheDocument()
    })
  })
})
