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

  it('renders guide view when URL has ?view=guide', () => {
    mockGet.mockReturnValue('guide')
    render(<SettingsContent />)

    expect(screen.getByText('Back to Settings')).toBeInTheDocument()
    expect(screen.getByText('Connect Sluice to Claude Desktop')).toBeInTheDocument()
    expect(screen.queryByText('Integrations')).not.toBeInTheDocument()
  })

  it('calls router.replace with guide URL when CTA card is clicked', () => {
    render(<SettingsContent />)

    fireEvent.click(screen.getByText('Claude Desktop'))

    expect(mockReplace).toHaveBeenCalledWith('/settings?view=guide', { scroll: false })
  })

  it('calls router.replace with landing URL when back button is clicked', () => {
    mockGet.mockReturnValue('guide')
    render(<SettingsContent />)

    fireEvent.click(screen.getByText('Back to Settings'))

    expect(mockReplace).toHaveBeenCalledWith('/settings', { scroll: false })
  })
})
