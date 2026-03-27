import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChannelFilterDropdown } from '../ChannelFilterDropdown'

const mockChannels = [
  {
    id: 1,
    channelId: 'UC_channel_1',
    name: 'Fireship',
    thumbnailUrl: 'https://example.com/thumb1.jpg',
    createdAt: new Date('2024-01-01'),
  },
  {
    id: 2,
    channelId: 'UC_channel_2',
    name: 'ThePrimeagen',
    thumbnailUrl: null,
    createdAt: new Date('2024-01-02'),
  },
  {
    id: 3,
    channelId: 'UC_channel_3',
    name: 'Tom Scott',
    thumbnailUrl: 'https://example.com/thumb3.jpg',
    createdAt: new Date('2024-01-03'),
  },
]

describe('ChannelFilterDropdown', () => {
  it('renders with default "All Channels" trigger text when selectedChannelId is null', () => {
    const onChannelChange = vi.fn()
    render(
      <ChannelFilterDropdown
        channels={mockChannels}
        selectedChannelId={null}
        onChannelChange={onChannelChange}
      />
    )

    expect(screen.getByText('All Channels')).toBeInTheDocument()
  })

  it('renders with selected channel name as trigger text when a channel is selected', () => {
    const onChannelChange = vi.fn()
    render(
      <ChannelFilterDropdown
        channels={mockChannels}
        selectedChannelId="UC_channel_2"
        onChannelChange={onChannelChange}
      />
    )

    expect(screen.getByText('ThePrimeagen')).toBeInTheDocument()
  })

  it('opens menu and displays "All Channels" option at top', async () => {
    const user = userEvent.setup()
    const onChannelChange = vi.fn()
    render(
      <ChannelFilterDropdown
        channels={mockChannels}
        selectedChannelId={null}
        onChannelChange={onChannelChange}
      />
    )

    await user.click(screen.getByText('All Channels'))

    // Should have two "All Channels" — one in trigger, one in menu
    const allChannelsItems = screen.getAllByText('All Channels')
    expect(allChannelsItems.length).toBeGreaterThanOrEqual(2)
  })

  it('displays all channel names in the menu', async () => {
    const user = userEvent.setup()
    const onChannelChange = vi.fn()
    render(
      <ChannelFilterDropdown
        channels={mockChannels}
        selectedChannelId={null}
        onChannelChange={onChannelChange}
      />
    )

    await user.click(screen.getByText('All Channels'))

    expect(screen.getByText('Fireship')).toBeInTheDocument()
    expect(screen.getByText('ThePrimeagen')).toBeInTheDocument()
    expect(screen.getByText('Tom Scott')).toBeInTheDocument()
  })

  it('calls onChannelChange with channelId when a channel is selected', async () => {
    const user = userEvent.setup()
    const onChannelChange = vi.fn()
    render(
      <ChannelFilterDropdown
        channels={mockChannels}
        selectedChannelId={null}
        onChannelChange={onChannelChange}
      />
    )

    await user.click(screen.getByText('All Channels'))
    await user.click(screen.getByText('Fireship'))

    expect(onChannelChange).toHaveBeenCalledWith('UC_channel_1')
    expect(onChannelChange).toHaveBeenCalledTimes(1)
  })

  it('calls onChannelChange with null when "All Channels" is selected', async () => {
    const user = userEvent.setup()
    const onChannelChange = vi.fn()
    render(
      <ChannelFilterDropdown
        channels={mockChannels}
        selectedChannelId="UC_channel_1"
        onChannelChange={onChannelChange}
      />
    )

    await user.click(screen.getByText('Fireship'))

    // Click the "All Channels" menu item (not the trigger)
    const allChannelsItems = screen.getAllByText('All Channels')
    const menuItem = allChannelsItems.find(el => el.closest('[role="menuitem"]'))
    expect(menuItem).toBeDefined()

    await user.click(menuItem!)

    expect(onChannelChange).toHaveBeenCalledWith(null)
    expect(onChannelChange).toHaveBeenCalledTimes(1)
  })

  it('handles empty channels array gracefully', () => {
    const onChannelChange = vi.fn()
    render(
      <ChannelFilterDropdown
        channels={[]}
        selectedChannelId={null}
        onChannelChange={onChannelChange}
      />
    )

    expect(screen.getByText('All Channels')).toBeInTheDocument()
  })

  it('renders ChevronDown icon in trigger', () => {
    const onChannelChange = vi.fn()
    const { container } = render(
      <ChannelFilterDropdown
        channels={mockChannels}
        selectedChannelId={null}
        onChannelChange={onChannelChange}
      />
    )

    // Check for lucide-react icon (it adds data-lucide attribute or specific class)
    const icon = container.querySelector('svg')
    expect(icon).toBeInTheDocument()
  })

  describe('unfollow X button', () => {
    it('renders an X button for each channel in the open menu', async () => {
      const user = userEvent.setup()
      const onChannelChange = vi.fn()
      const onUnfollow = vi.fn()
      render(
        <ChannelFilterDropdown
          channels={mockChannels}
          selectedChannelId={null}
          onChannelChange={onChannelChange}
          onUnfollow={onUnfollow}
        />
      )

      await user.click(screen.getByText('All Channels'))

      // One X button per channel (3), none for "All Channels" item
      const xButtons = screen.getAllByRole('menuitem', { name: /unfollow/i })
      expect(xButtons).toHaveLength(3)
    })

    it('does not render X buttons when onUnfollow prop is not provided', async () => {
      const user = userEvent.setup()
      const onChannelChange = vi.fn()
      render(
        <ChannelFilterDropdown
          channels={mockChannels}
          selectedChannelId={null}
          onChannelChange={onChannelChange}
        />
      )

      await user.click(screen.getByText('All Channels'))

      const xButtons = screen.queryAllByRole('menuitem', { name: /unfollow/i })
      expect(xButtons).toHaveLength(0)
    })

    it('shows confirm dialog and calls onUnfollow with channel id when confirmed', async () => {
      const user = userEvent.setup()
      const onChannelChange = vi.fn()
      const onUnfollow = vi.fn()
      vi.spyOn(window, 'confirm').mockReturnValue(true)

      render(
        <ChannelFilterDropdown
          channels={mockChannels}
          selectedChannelId={null}
          onChannelChange={onChannelChange}
          onUnfollow={onUnfollow}
        />
      )

      await user.click(screen.getByText('All Channels'))

      const [firstXButton] = screen.getAllByRole('menuitem', { name: /unfollow fireship/i })
      await user.click(firstXButton!)

      expect(window.confirm).toHaveBeenCalledWith(
        'Unfollow Fireship? Videos already in your bank will stay.'
      )
      expect(onUnfollow).toHaveBeenCalledWith(1)
      expect(onUnfollow).toHaveBeenCalledTimes(1)
    })

    it('does not call onUnfollow when confirm dialog is cancelled', async () => {
      const user = userEvent.setup()
      const onChannelChange = vi.fn()
      const onUnfollow = vi.fn()
      vi.spyOn(window, 'confirm').mockReturnValue(false)

      render(
        <ChannelFilterDropdown
          channels={mockChannels}
          selectedChannelId={null}
          onChannelChange={onChannelChange}
          onUnfollow={onUnfollow}
        />
      )

      await user.click(screen.getByText('All Channels'))

      const [firstXButton] = screen.getAllByRole('menuitem', { name: /unfollow/i })
      await user.click(firstXButton!)

      expect(onUnfollow).not.toHaveBeenCalled()
    })

    it('clicking X button does not trigger channel selection', async () => {
      const user = userEvent.setup()
      const onChannelChange = vi.fn()
      const onUnfollow = vi.fn()
      vi.spyOn(window, 'confirm').mockReturnValue(true)

      render(
        <ChannelFilterDropdown
          channels={mockChannels}
          selectedChannelId={null}
          onChannelChange={onChannelChange}
          onUnfollow={onUnfollow}
        />
      )

      await user.click(screen.getByText('All Channels'))

      const [firstXButton] = screen.getAllByRole('menuitem', { name: /unfollow fireship/i })
      await user.click(firstXButton!)

      expect(onChannelChange).not.toHaveBeenCalled()
    })
  })
})
