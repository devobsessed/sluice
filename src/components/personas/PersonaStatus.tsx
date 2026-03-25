'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Loader2, MessageCircle } from 'lucide-react'
import { usePersonaStatus } from '@/components/providers/PersonaStatusProvider'
import type { PersonaChannel } from '@/components/providers/PersonaStatusProvider'

const MAX_VISIBLE = 5

function sortChannels(channels: PersonaChannel[], threshold: number) {
  return [...channels].sort((a, b) => {
    const aIsActive = a.personaId !== null
    const bIsActive = b.personaId !== null
    const aIsReady = !aIsActive && a.transcriptCount >= threshold
    const bIsReady = !bIsActive && b.transcriptCount >= threshold

    // Active personas first
    if (aIsActive && !bIsActive) return -1
    if (!aIsActive && bIsActive) return 1

    // If both active, sort by transcript count desc
    if (aIsActive && bIsActive) {
      return b.transcriptCount - a.transcriptCount
    }

    // Ready personas next
    if (aIsReady && !bIsReady) return -1
    if (!aIsReady && bIsReady) return 1

    // Within same tier, sort by transcript count desc
    return b.transcriptCount - a.transcriptCount
  })
}

export function PersonaStatusSkeleton() {
  return (
    <div data-testid="persona-status-skeleton" className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="h-4 w-16 animate-pulse rounded bg-muted" />
        <div className="h-4 w-28 animate-pulse rounded bg-muted" />
      </div>
      <div className="flex flex-wrap gap-2">
        {[140, 160, 120, 180].map((width, i) => (
          <div
            key={i}
            className="h-8 animate-pulse rounded-full bg-muted"
            style={{ width: `${width}px` }}
          />
        ))}
      </div>
    </div>
  )
}

interface PersonaStatusProps {
  onActivePersonasChange?: (hasActive: boolean) => void
}

export function PersonaStatus({ onActivePersonasChange }: PersonaStatusProps) {
  const { channels, threshold, isLoading, updateChannel } = usePersonaStatus()
  const [creating, setCreating] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)

  // Notify parent about active personas whenever channels data changes
  useEffect(() => {
    if (!isLoading) {
      const hasActive = channels.some(c => c.personaId !== null)
      onActivePersonasChange?.(hasActive)
    }
  }, [channels, isLoading, onActivePersonasChange])

  const handleCreate = useCallback(async (channelName: string) => {
    setCreating(channelName)
    setError(null)
    try {
      const response = await fetch('/api/personas', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ channelName }),
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to create persona')
      }
      const result = await response.json()

      // Update shared provider state so ChatHubDrawer also sees the new persona
      updateChannel(channelName, {
        personaId: result.persona.id,
        personaCreatedAt: new Date().toISOString(),
      })

      // Notify parent that we now have an active persona
      onActivePersonasChange?.(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create persona')
    } finally {
      setCreating(null)
    }
  }, [onActivePersonasChange, updateChannel])

  // Loading state
  if (isLoading) {
    return <PersonaStatusSkeleton />
  }

  // Don't render if no channels
  if (channels.length === 0) {
    return null
  }

  const sortedChannels = sortChannels(channels, threshold)
  const activeCount = channels.filter(c => c.personaId !== null).length
  const buildingCount = channels.filter(c => c.personaId === null && c.transcriptCount < threshold).length

  // Determine visible channels
  // Always show all active personas, then fill to MAX_VISIBLE
  const minVisible = Math.max(activeCount, MAX_VISIBLE)
  const visibleChannels = expanded ? sortedChannels : sortedChannels.slice(0, minVisible)
  const hasMore = sortedChannels.length > minVisible

  return (
    <div className="space-y-3">
      {/* Section header */}
      <div className="text-sm text-muted-foreground">
        <span className="font-medium">Personas</span>
        {' '}
        <span>
          ({activeCount} active · {buildingCount} building)
        </span>
      </div>

      {/* Channel cards */}
      <div className="flex flex-wrap gap-2 transition-all duration-200">
        {visibleChannels.map(channel => {
          const isActive = channel.personaId !== null
          const isReady = !isActive && channel.transcriptCount >= threshold
          const isBuilding = !isActive && channel.transcriptCount < threshold

          // Active persona card
          if (isActive) {
            const personaDisplayName = channel.personaName || channel.channelName
            return (
              <div
                key={channel.channelName}
                className="flex items-center gap-1.5 rounded-full border bg-green-500/10 px-3 py-1 text-sm text-green-700 dark:text-green-400 min-w-[160px] max-w-[280px]"
              >
                <span className="font-medium truncate" title={channel.channelName}>@{channel.channelName}</span>
                <span className="text-green-600 dark:text-green-400">✓</span>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="ml-auto text-green-700 dark:text-green-400 hover:text-primary"
                  aria-label={`Chat with ${personaDisplayName}`}
                  data-testid={`chat-btn-${channel.channelName}`}
                  onClick={() =>
                    window.dispatchEvent(
                      new CustomEvent('persona-chat:open', {
                        detail: {
                          personaId: channel.personaId!,
                          personaName: personaDisplayName,
                          expertiseTopics: channel.expertiseTopics ?? [],
                        },
                      })
                    )
                  }
                >
                  <MessageCircle />
                </Button>
              </div>
            )
          }

          // Ready to create card
          if (isReady) {
            return (
              <div
                key={channel.channelName}
                className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm min-w-[160px] max-w-[280px]"
              >
                <span className="font-medium truncate" title={channel.channelName}>@{channel.channelName}</span>
                <span className="text-muted-foreground">
                  ({channel.transcriptCount} transcripts)
                </span>
                <Button
                  size="xs"
                  onClick={() => handleCreate(channel.channelName)}
                  disabled={creating !== null}
                >
                  {creating === channel.channelName ? (
                    <>
                      <Loader2 className="size-3 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    'Create'
                  )}
                </Button>
              </div>
            )
          }

          // Building card
          if (isBuilding) {
            const progress = (channel.transcriptCount / threshold) * 100
            const remaining = threshold - channel.transcriptCount

            return (
              <div
                key={channel.channelName}
                className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm min-w-[160px] max-w-[280px]"
              >
                <span className="font-medium truncate" title={channel.channelName}>@{channel.channelName}</span>
                <span className="text-muted-foreground">
                  {channel.transcriptCount}/{threshold}
                </span>
                <div className="flex items-center gap-1.5">
                  <div
                    className="h-1.5 w-12 overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    aria-valuenow={channel.transcriptCount}
                    aria-valuemin={0}
                    aria-valuemax={threshold}
                  >
                    <div
                      className="h-full bg-primary transition-all"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {remaining} more needed
                  </span>
                </div>
              </div>
            )
          }

          return null
        })}
      </div>

      {/* Toggle button */}
      {hasMore && (
        <Button
          variant="ghost"
          size="xs"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded
            ? 'Show less'
            : `Show all ${sortedChannels.length} channels`}
        </Button>
      )}

      {/* Error message */}
      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}
    </div>
  )
}
