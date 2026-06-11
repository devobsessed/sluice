import { describe, it, expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SourceCitation } from '../SourceCitation'

describe('SourceCitation - extended props (startTime, youtubeId)', () => {
  const baseSource = {
    chunkId: 1,
    content: 'Some important content here',
    videoTitle: 'Video One',
  }

  it('renders without timestamp/youtubeId (backward-compat with PersonaColumn)', async () => {
    const user = userEvent.setup()
    render(<SourceCitation sources={[baseSource]} />)

    const button = screen.getByRole('button', { name: /source/i })
    await user.click(button)

    expect(screen.getByText('Some important content here')).toBeInTheDocument()
    expect(screen.getByText('Video One')).toBeInTheDocument()
    // No timestamp link rendered
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('renders a video+timestamp link when youtubeId is provided', async () => {
    const user = userEvent.setup()
    const source = {
      ...baseSource,
      startTime: 135,
      youtubeId: 'abc123xyz',
    }
    render(<SourceCitation sources={[source]} />)

    const button = screen.getByRole('button', { name: /source/i })
    await user.click(button)

    const link = screen.getByRole('link')
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute('href', expect.stringContaining('abc123xyz'))
    expect(link).toHaveAttribute('href', expect.stringContaining('135'))
  })

  it('does not render a link when youtubeId is null', async () => {
    const user = userEvent.setup()
    const source = {
      ...baseSource,
      startTime: 135,
      youtubeId: null,
    }
    render(<SourceCitation sources={[source]} />)

    const button = screen.getByRole('button', { name: /source/i })
    await user.click(button)

    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('does not render a link when startTime is null', async () => {
    const user = userEvent.setup()
    const source = {
      ...baseSource,
      startTime: null,
      youtubeId: 'abc123xyz',
    }
    render(<SourceCitation sources={[source]} />)

    const button = screen.getByRole('button', { name: /source/i })
    await user.click(button)

    // Without startTime, no YouTube timestamp link
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('renders numbered source entries (n matches context block number)', async () => {
    const user = userEvent.setup()
    const sources = [
      { chunkId: 10, content: 'First source content', videoTitle: 'Video Alpha' },
      { chunkId: 20, content: 'Second source content', videoTitle: 'Video Beta' },
    ]
    render(<SourceCitation sources={sources} />)

    const button = screen.getByRole('button', { name: /2 sources/i })
    await user.click(button)

    // Numbered labels should appear: [1] and [2]
    expect(screen.getByText('[1]')).toBeInTheDocument()
    expect(screen.getByText('[2]')).toBeInTheDocument()
  })

  it('supports highlight prop for targeted entry', async () => {
    const sources = [
      { chunkId: 1, content: 'First content', videoTitle: 'Video One' },
      { chunkId: 2, content: 'Second content', videoTitle: 'Video Two' },
    ]
    // highlightIndex triggers the useEffect which opens the collapsible
    render(<SourceCitation sources={sources} highlightIndex={1} />)

    // The useEffect opens the collapsible - entries should become visible
    await waitFor(() => {
      const secondEntry = screen.getByTestId('source-entry-1')
      expect(secondEntry).toBeInTheDocument()
    })
  })

  it('opens collapsible when forceOpen prop is true', () => {
    const sources = [
      { chunkId: 1, content: 'Auto-open content', videoTitle: 'Video One' },
    ]
    render(<SourceCitation sources={sources} forceOpen />)

    // Content should be visible without clicking
    expect(screen.getByText('Auto-open content')).toBeInTheDocument()
  })
})
