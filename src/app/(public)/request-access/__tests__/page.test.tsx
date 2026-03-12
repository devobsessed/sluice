import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

// Mock fetch
const mockFetch = vi.fn()
global.fetch = mockFetch

import RequestAccessPage from '../page'

describe('RequestAccessPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the form with name, email, and message fields', () => {
    render(<RequestAccessPage />)
    expect(screen.getByLabelText('Name')).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
    expect(screen.getByText(/why do you want access/i)).toBeInTheDocument()
  })

  it('renders Sluice branding', () => {
    render(<RequestAccessPage />)
    expect(screen.getByText('Sluice')).toBeInTheDocument()
    expect(screen.getByLabelText('Sluice logo')).toBeInTheDocument()
  })

  it('renders card header with title and description', () => {
    render(<RequestAccessPage />)
    expect(screen.getByText('Request Access')).toBeInTheDocument()
    expect(screen.getByText('Tell us a bit about yourself.')).toBeInTheDocument()
  })

  it('renders "Already have access? Sign in" link', () => {
    render(<RequestAccessPage />)
    const link = screen.getByRole('link', { name: /sign in/i })
    expect(link).toHaveAttribute('href', '/sign-in')
  })

  it('disables submit button when name is empty', () => {
    render(<RequestAccessPage />)
    expect(screen.getByRole('button', { name: /submit request/i })).toBeDisabled()
  })

  it('disables submit button when email is empty', async () => {
    const user = userEvent.setup()
    render(<RequestAccessPage />)

    await user.type(screen.getByLabelText('Name'), 'Test User')
    expect(screen.getByRole('button', { name: /submit request/i })).toBeDisabled()
  })

  it('enables submit button when name and email are filled', async () => {
    const user = userEvent.setup()
    render(<RequestAccessPage />)

    await user.type(screen.getByLabelText('Name'), 'Test User')
    await user.type(screen.getByLabelText('Email'), 'user@example.com')
    expect(screen.getByRole('button', { name: /submit request/i })).toBeEnabled()
  })

  it('submits the form and shows success state', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 1, email: 'user@example.com' }),
    })

    const user = userEvent.setup()
    render(<RequestAccessPage />)

    await user.type(screen.getByLabelText('Name'), 'Test User')
    await user.type(screen.getByLabelText('Email'), 'user@example.com')
    await user.click(screen.getByRole('button', { name: /submit request/i }))

    await waitFor(() => {
      expect(screen.getByTestId('success-state')).toBeInTheDocument()
    })

    expect(screen.getByText('Request received!')).toBeInTheDocument()
    expect(screen.getByText('user@example.com')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /back to sign in/i })).toHaveAttribute('href', '/sign-in')
  })

  it('sends correct payload to API', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 1, email: 'user@example.com' }),
    })

    const user = userEvent.setup()
    render(<RequestAccessPage />)

    await user.type(screen.getByLabelText('Name'), 'Test User')
    await user.type(screen.getByLabelText('Email'), 'user@example.com')
    await user.type(screen.getByPlaceholderText(/tell us why/i), 'I want to learn')
    await user.click(screen.getByRole('button', { name: /submit request/i }))

    expect(mockFetch).toHaveBeenCalledWith('/api/access-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test User',
        email: 'user@example.com',
        message: 'I want to learn',
      }),
    })
  })

  it('shows loading state while submitting', async () => {
    mockFetch.mockReturnValueOnce(new Promise(() => {})) // never resolves

    const user = userEvent.setup()
    render(<RequestAccessPage />)

    await user.type(screen.getByLabelText('Name'), 'Test User')
    await user.type(screen.getByLabelText('Email'), 'user@example.com')
    await user.click(screen.getByRole('button', { name: /submit request/i }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /submitting/i })).toBeDisabled()
    })
  })

  it('shows server error message on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'A request for this email is already pending.' }),
    })

    const user = userEvent.setup()
    render(<RequestAccessPage />)

    await user.type(screen.getByLabelText('Name'), 'Test User')
    await user.type(screen.getByLabelText('Email'), 'user@example.com')
    await user.click(screen.getByRole('button', { name: /submit request/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('A request for this email is already pending.')
    })
  })

  it('shows fallback error on network failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'))

    const user = userEvent.setup()
    render(<RequestAccessPage />)

    await user.type(screen.getByLabelText('Name'), 'Test User')
    await user.type(screen.getByLabelText('Email'), 'user@example.com')
    await user.click(screen.getByRole('button', { name: /submit request/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong. Please try again.')
    })
  })

  it('does not show success state when form has errors', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Email is required' }),
    })

    const user = userEvent.setup()
    render(<RequestAccessPage />)

    await user.type(screen.getByLabelText('Name'), 'Test User')
    await user.type(screen.getByLabelText('Email'), 'user@example.com')
    await user.click(screen.getByRole('button', { name: /submit request/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })

    expect(screen.queryByTestId('success-state')).not.toBeInTheDocument()
  })
})
