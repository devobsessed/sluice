import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SettingsContent } from '../SettingsContent'

const mockReplace = vi.fn()
const mockGet = vi.fn().mockReturnValue(null)

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: mockGet }),
  useRouter: () => ({ replace: mockReplace }),
}))

// Mock usePageTitle (used by layout context - mock in case sub-components trigger it)
vi.mock('@/components/layout/PageTitleContext', () => ({
  usePageTitle: () => ({ setPageTitle: vi.fn() }),
}))

// Mock next-themes (ThemeToggle uses useTheme)
vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'system', setTheme: vi.fn() }),
}))

// Mock auth-client (AdminSettingsLink uses useSession)
vi.mock('@/lib/auth-client', () => ({
  useSession: () => ({ data: null }),
}))

describe('SettingsContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGet.mockReturnValue(null)
  })

  it('renders the settings landing with Appearance and Integrations sections', () => {
    render(<SettingsContent />)

    expect(screen.getByText('Appearance')).toBeInTheDocument()
    expect(screen.getByText('Integrations')).toBeInTheDocument()
    expect(screen.getByText('Claude Desktop')).toBeInTheDocument()
    expect(
      screen.getByText('Connect your knowledge bank to Claude Desktop'),
    ).toBeInTheDocument()
  })

  it('switches to guide view when CTA card is clicked', () => {
    render(<SettingsContent />)

    fireEvent.click(screen.getByText('Claude Desktop'))

    expect(screen.getByText('Back to Settings')).toBeInTheDocument()
    expect(screen.getByText('Connect Sluice to Claude Desktop')).toBeInTheDocument()
    expect(screen.queryByText('Integrations')).not.toBeInTheDocument()
  })

  it('opens guide view directly when URL has ?view=guide', () => {
    mockGet.mockReturnValue('guide')
    render(<SettingsContent />)

    expect(screen.getByText('Back to Settings')).toBeInTheDocument()
    expect(screen.getByText('Connect Sluice to Claude Desktop')).toBeInTheDocument()
    expect(screen.queryByText('Integrations')).not.toBeInTheDocument()
  })

  it('updates URL when navigating between views', () => {
    render(<SettingsContent />)

    fireEvent.click(screen.getByText('Claude Desktop'))
    expect(mockReplace).toHaveBeenCalledWith('/settings?view=guide', { scroll: false })

    fireEvent.click(screen.getByText('Back to Settings'))
    expect(mockReplace).toHaveBeenCalledWith('/settings', { scroll: false })
  })

  it('returns to landing when back button is clicked', () => {
    render(<SettingsContent />)

    // Navigate to guide
    fireEvent.click(screen.getByText('Claude Desktop'))
    expect(screen.getByText('Back to Settings')).toBeInTheDocument()

    // Navigate back
    fireEvent.click(screen.getByText('Back to Settings'))

    expect(screen.getByText('Integrations')).toBeInTheDocument()
    expect(screen.queryByText('Back to Settings')).not.toBeInTheDocument()
  })
})
