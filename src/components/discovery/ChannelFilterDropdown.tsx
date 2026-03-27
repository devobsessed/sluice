'use client'

import { ChevronDown, X } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface Channel {
  id: number
  channelId: string
  name: string
  thumbnailUrl?: string | null
  feedUrl?: string | null
  autoFetch?: boolean | null
  lastFetchedAt?: Date | null
  fetchIntervalHours?: number | null
  createdAt: Date
}

interface ChannelFilterDropdownProps {
  channels: Channel[]
  selectedChannelId: string | null
  onChannelChange: (channelId: string | null) => void
  onUnfollow?: (channelId: number) => void
}

export function ChannelFilterDropdown({
  channels,
  selectedChannelId,
  onChannelChange,
  onUnfollow,
}: ChannelFilterDropdownProps) {
  // Find the selected channel to display its name
  const selectedChannel = channels.find((channel) => channel.channelId === selectedChannelId)
  const displayName = selectedChannel ? selectedChannel.name : 'All Channels'

  const handleSelectChannel = (channelId: string | null) => {
    onChannelChange(channelId)
  }

  const handleUnfollowClick = (e: React.MouseEvent, channel: Channel) => {
    e.stopPropagation()
    const confirmed = window.confirm(
      `Unfollow ${channel.name}? Videos already in your bank will stay.`
    )
    if (confirmed) {
      onUnfollow?.(channel.id)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="rounded-full px-4 py-1.5 text-sm bg-muted hover:bg-muted/80 transition-colors flex items-center gap-2 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        {displayName}
        <ChevronDown className="h-4 w-4 opacity-50" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onClick={() => handleSelectChannel(null)}>
          All Channels
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {channels.map((channel) => (
          <div key={channel.id} className="flex items-center">
            <DropdownMenuItem
              onClick={() => handleSelectChannel(channel.channelId)}
              className="flex-1 truncate px-3 py-2"
            >
              {channel.name}
            </DropdownMenuItem>
            {onUnfollow && (
              <DropdownMenuItem
                variant="destructive"
                aria-label={`Unfollow ${channel.name}`}
                onClick={(e) => {
                  e.preventDefault()
                  handleUnfollowClick(e, channel)
                }}
                className="shrink-0 px-2 py-2"
              >
                <X size={14} />
              </DropdownMenuItem>
            )}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
