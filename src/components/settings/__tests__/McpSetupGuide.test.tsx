import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { McpSetupGuide } from '../McpSetupGuide'

describe('McpSetupGuide', () => {
  const mockOnBack = vi.fn()

  it('renders the guide header', () => {
    render(<McpSetupGuide onBack={mockOnBack} />)

    expect(screen.getByText('Connect Sluice to Claude Desktop')).toBeInTheDocument()
    expect(
      screen.getByText('Give Claude access to your knowledge bank in 5 minutes'),
    ).toBeInTheDocument()
  })

  it('renders the Vinh Giang narrator pill', () => {
    render(<McpSetupGuide onBack={mockOnBack} />)

    expect(screen.getByText('Vinh Giang')).toBeInTheDocument()
  })

  it('renders all 6 step titles', () => {
    render(<McpSetupGuide onBack={mockOnBack} />)

    expect(screen.getByText('Open Settings in Claude Desktop')).toBeInTheDocument()
    expect(screen.getByText('Go to Developer and click Edit Config')).toBeInTheDocument()
    expect(screen.getByText('Open the config file in TextEdit')).toBeInTheDocument()
    expect(screen.getByText('Add the Sluice MCP configuration')).toBeInTheDocument()
    expect(screen.getByText('Save the file')).toBeInTheDocument()
    expect(screen.getByText('Restart Claude Desktop')).toBeInTheDocument()
  })

  it('renders all 4 MCP tool cards', () => {
    render(<McpSetupGuide onBack={mockOnBack} />)

    expect(screen.getByText('search_rag')).toBeInTheDocument()
    expect(screen.getByText('get_list_of_creators')).toBeInTheDocument()
    expect(screen.getByText('chat_with_persona')).toBeInTheDocument()
    expect(screen.getByText('ensemble_query')).toBeInTheDocument()
  })

  it('renders the prerequisites section', () => {
    render(<McpSetupGuide onBack={mockOnBack} />)

    expect(screen.getByText('Before you start')).toBeInTheDocument()
    expect(screen.getByText('Claude Desktop installed on your Mac')).toBeInTheDocument()
  })

  it('calls onBack when back button is clicked', () => {
    render(<McpSetupGuide onBack={mockOnBack} />)

    fireEvent.click(screen.getByText('Back to Settings'))

    expect(mockOnBack).toHaveBeenCalledTimes(1)
  })

  it('renders 6 screenshot images', () => {
    render(<McpSetupGuide onBack={mockOnBack} />)

    const images = screen.getAllByRole('img')
    expect(images).toHaveLength(6)
    expect(images[0]).toHaveAttribute('src', '/images/mcp-setup/step-1-open-settings.png')
    expect(images[5]).toHaveAttribute(
      'src',
      '/images/mcp-setup/step-6-restart-server-open-settings-developer-sluice-connected.png',
    )
  })
})
