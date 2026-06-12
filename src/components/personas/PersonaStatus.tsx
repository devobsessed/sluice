'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Loader2, MessageCircle, RefreshCw } from 'lucide-react'
import { usePersonaStatus } from '@/components/providers/PersonaStatusProvider'
import type { PersonaChannel } from '@/components/providers/PersonaStatusProvider'

const MAX_VISIBLE = 5

/** Number of new transcripts since generation that triggers the staleness badge. */
export const STALENESS_THRESHOLD = 3

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

/** Confirm dialog state for the staleness rebuild flow */
interface RebuildConfirm {
  channelName: string
  personaId: number
  personaDisplayName: string
  newCount: number
}

export function PersonaStatus({ onActivePersonasChange }: PersonaStatusProps) {
  const { channels, threshold, isLoading, updateChannel, refetch } = usePersonaStatus()
  const [creating, setCreating] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)

  // Local in-flight regenerating state: channelName -> boolean
  // Merges with server-side regeneratingAt for the pill microstate
  const [localRebuilding, setLocalRebuilding] = useState<Set<string>>(new Set())
  // Brief "Updated" done state: set of channelNames showing the done state
  const [localDone, setLocalDone] = useState<Set<string>>(new Set())
  // Confirm dialog state - null = closed
  const [rebuildConfirm, setRebuildConfirm] = useState<RebuildConfirm | null>(null)

  // Stable ref to track active done-state timers so we can clear on unmount
  const doneTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  useEffect(() => {
    // Capture ref value so the cleanup sees the correct map at the time the effect ran
    const timers = doneTimers.current
    return () => {
      timers.forEach(t => clearTimeout(t))
    }
  }, [])

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

  const handleRebuildConfirm = useCallback(async () => {
    if (!rebuildConfirm) return
    const { channelName, personaId } = rebuildConfirm
    setRebuildConfirm(null)

    setLocalRebuilding(prev => new Set(prev).add(channelName))

    try {
      await fetch(`/api/personas/${personaId}/regenerate`, { method: 'POST' })

      // Transition from in-flight to done before refetch to avoid the loading
      // skeleton (fetchStatus sets isLoading=true) hiding the "Updated" state.
      setLocalRebuilding(prev => {
        const next = new Set(prev)
        next.delete(channelName)
        return next
      })
      setLocalDone(prev => new Set(prev).add(channelName))

      // Fire-and-forget refetch: pull the advanced baseline from the server.
      // Don't await - the done state needs to remain visible during the load.
      refetch()

      const timer = setTimeout(() => {
        setLocalDone(prev => {
          const next = new Set(prev)
          next.delete(channelName)
          return next
        })
        doneTimers.current.delete(channelName)
      }, 2500)
      doneTimers.current.set(channelName, timer)
    } catch {
      // On error just clear the in-flight state silently - persona still works
      setLocalRebuilding(prev => {
        const next = new Set(prev)
        next.delete(channelName)
        return next
      })
    }
  }, [rebuildConfirm, refetch])

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

            // Staleness: gap of 3+ new transcripts since generation.
            // personaTranscriptCount is null (no persona baseline) or number.
            // Treat undefined as null (older fixtures without the field).
            const atGen = channel.personaTranscriptCount ?? null
            const delta = atGen !== null ? channel.transcriptCount - atGen : 0
            const isStale = atGen !== null && delta >= STALENESS_THRESHOLD

            // In-flight: server-truth (regeneratingAt from another user) OR local POST
            const isRebuilding =
              Boolean(channel.regeneratingAt) ||
              localRebuilding.has(channel.channelName)

            // Brief done state after a successful local rebuild
            const isDone = localDone.has(channel.channelName)

            return (
              <div
                key={channel.channelName}
                className="flex items-center gap-1.5 rounded-full border bg-green-500/10 px-3 py-1 text-sm text-green-700 dark:text-green-400 min-w-[160px] max-w-[280px]"
              >
                <span className="font-medium truncate" title={channel.channelName}>@{channel.channelName}</span>
                {/* In-flight: rebuilding microstate */}
                {isRebuilding ? (
                  <span className="flex items-center gap-1 shrink-0 text-xs text-muted-foreground">
                    <RefreshCw className="size-3 animate-spin" aria-hidden="true" />
                    Rebuilding...
                  </span>
                ) : isDone ? (
                  /* Brief done state */
                  <span className="shrink-0 text-xs text-green-600 dark:text-green-400">
                    Updated
                  </span>
                ) : (
                  <>
                    <span className="text-green-600 dark:text-green-400">✓</span>
                    {/* Staleness badge: size-3 dot, but wrapped in a >= 44px touch target */}
                    {isStale && (
                      <button
                        type="button"
                        aria-label={`${delta} new videos since this persona was built - rebuild`}
                        className="relative flex items-center justify-center min-h-[44px] min-w-[44px] -my-[10px] shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded"
                        onClick={() =>
                          setRebuildConfirm({
                            channelName: channel.channelName,
                            personaId: channel.personaId!,
                            personaDisplayName,
                            newCount: delta,
                          })
                        }
                      >
                        <span className="size-3 rounded-full bg-[#059669]" />
                      </button>
                    )}
                  </>
                )}
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

      {/* Rebuild confirm dialog */}
      <Dialog
        open={rebuildConfirm !== null}
        onOpenChange={open => {
          if (!open) setRebuildConfirm(null)
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>
              Rebuild {rebuildConfirm?.personaDisplayName} from {rebuildConfirm?.newCount} new videos?
            </DialogTitle>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRebuildConfirm(null)}
            >
              Cancel
            </Button>
            <Button onClick={handleRebuildConfirm}>
              Rebuild
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
