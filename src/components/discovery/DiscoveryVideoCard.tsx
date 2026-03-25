'use client'

import Link from 'next/link'
import Image from 'next/image'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatRelativeTime } from '@/lib/time-utils'
import { Loader2, Check, X } from 'lucide-react'
import type { BatchItemStatus } from '@/hooks/useBatchAdd'

export interface DiscoveryVideo {
  youtubeId: string
  title: string
  channelId: string
  channelName: string
  publishedAt: string | null
  description: string
  inBank: boolean
}

interface DiscoveryVideoCardProps {
  video: DiscoveryVideo
  className?: string
  isNew?: boolean
  focusAreas?: { id: number; name: string; color: string }[]
  returnTo?: string
  selectable?: boolean
  selected?: boolean
  onToggleSelect?: (youtubeId: string) => void
  batchStatus?: BatchItemStatus
  bankVideoId?: number
}

export function DiscoveryVideoCard({
  video,
  className,
  isNew = false,
  focusAreas,
  returnTo,
  selectable = false,
  selected = false,
  onToggleSelect,
  batchStatus,
  bankVideoId,
}: DiscoveryVideoCardProps) {
  const publishedDate = video.publishedAt ? new Date(video.publishedAt) : null
  const relativeTime = publishedDate ? formatRelativeTime(publishedDate) : null
  const thumbnailUrl = `https://i.ytimg.com/vi/${video.youtubeId}/mqdefault.jpg`
  const addUrl = `/add?url=https://youtube.com/watch?v=${video.youtubeId}${returnTo ? `&returnTo=${returnTo}` : ''}`

  // Build detail URL when video is in bank
  const detailUrl = bankVideoId && video.inBank
    ? `/videos/${bankVideoId}${returnTo ? `?returnTo=${returnTo}` : ''}`
    : undefined

  // Only show selection UI on not-saved cards
  const showSelectionUI = selectable && !video.inBank

  // When batch status is 'done', treat the card as if it's in the bank
  const isInBankOrDone = video.inBank || batchStatus === 'done'

  const handleCheckboxClick = (e: React.MouseEvent<HTMLInputElement>) => {
    e.stopPropagation()
    if (onToggleSelect) {
      onToggleSelect(video.youtubeId)
    }
  }

  return (
    <Card
      className={cn(
        'group overflow-hidden p-0 transition-all duration-200 hover:shadow-lg hover:scale-[1.02]',
        selected && 'ring-2 ring-primary transition-all duration-150',
        className
      )}
    >
      {/* Thumbnail */}
      {detailUrl ? (
        <Link href={detailUrl} className="relative aspect-video w-full overflow-hidden block cursor-pointer">
          <Image
            src={thumbnailUrl}
            alt={video.title}
            fill
            className="object-cover transition-transform duration-200 group-hover:scale-105"
            unoptimized
          />

          {/* Green "new" dot - moved to right to avoid checkbox */}
          {isNew && (
            <div className="absolute top-2 right-2 size-3 rounded-full bg-[#059669]" aria-label="New video" />
          )}

          {/* Batch status overlay */}
          {batchStatus && batchStatus !== 'pending' && (
            <div className="absolute inset-0 bg-background/60 flex items-center justify-center z-10">
              {(batchStatus === 'fetching-transcript' || batchStatus === 'saving') && (
                <Loader2 className="size-8 animate-spin text-primary" />
              )}
              {batchStatus === 'done' && (
                <div className="bg-green-500/20 rounded-full p-3 animate-in fade-in duration-300">
                  <Check className="size-8 text-green-600 dark:text-green-400" />
                </div>
              )}
              {batchStatus === 'error' && (
                <div className="bg-red-500/20 rounded-full p-3">
                  <X className="size-8 text-red-600 dark:text-red-400" />
                </div>
              )}
            </div>
          )}
        </Link>
      ) : (
        <div className="relative aspect-video w-full overflow-hidden">
          <Image
            src={thumbnailUrl}
            alt={video.title}
            fill
            className="object-cover transition-transform duration-200 group-hover:scale-105"
            unoptimized
          />

          {/* Selection checkbox */}
          {showSelectionUI && (
            <input
              type="checkbox"
              checked={selected}
              onChange={() => {}}
              onClick={handleCheckboxClick}
              className={cn(
                'absolute top-2 left-2 z-10 size-5 rounded border-2 accent-primary cursor-pointer transition-opacity duration-150',
                selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
              )}
              aria-label="Select video"
            />
          )}

          {/* Selection overlay */}
          {selected && (
            <div className="absolute inset-0 bg-primary/10 z-[5]" />
          )}

          {/* Green "new" dot - moved to right to avoid checkbox */}
          {isNew && (
            <div className="absolute top-2 right-2 size-3 rounded-full bg-[#059669]" aria-label="New video" />
          )}

          {/* Batch status overlay */}
          {batchStatus && batchStatus !== 'pending' && (
            <div className="absolute inset-0 bg-background/60 flex items-center justify-center z-10">
              {(batchStatus === 'fetching-transcript' || batchStatus === 'saving') && (
                <Loader2 className="size-8 animate-spin text-primary" />
              )}
              {batchStatus === 'done' && (
                <div className="bg-green-500/20 rounded-full p-3 animate-in fade-in duration-300">
                  <Check className="size-8 text-green-600 dark:text-green-400" />
                </div>
              )}
              {batchStatus === 'error' && (
                <div className="bg-red-500/20 rounded-full p-3">
                  <X className="size-8 text-red-600 dark:text-red-400" />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Content */}
      <div className="p-3 space-y-2">
        {detailUrl ? (
          <Link href={detailUrl}>
            <h3 className="line-clamp-2 font-semibold leading-tight text-sm cursor-pointer hover:underline">
              {video.title}
            </h3>
          </Link>
        ) : (
          <h3 className="line-clamp-2 font-semibold leading-tight text-sm">
            {video.title}
          </h3>
        )}
        <p className="text-xs text-muted-foreground">
          {relativeTime}
        </p>

        {/* Focus area badges */}
        {focusAreas && focusAreas.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {focusAreas.map((fa) => (
              <Badge key={fa.id} variant="secondary" className="text-[10px] px-1.5 py-0">
                {fa.name}
              </Badge>
            ))}
          </div>
        )}

        {/* Action: Add to Bank or In Bank badge */}
        {isInBankOrDone ? (
          <Badge variant="secondary" className="bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300 transition-opacity duration-200">
            <svg
              className="size-3"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            In Bank
          </Badge>
        ) : (
          <Button asChild size="sm" variant="outline" className="w-full">
            <Link href={addUrl}>
              Add to Bank
            </Link>
          </Button>
        )}
      </div>
    </Card>
  )
}

export function DiscoveryVideoCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border bg-card" data-testid="discovery-video-card-skeleton">
      {/* Thumbnail skeleton */}
      <div className="aspect-video w-full animate-pulse bg-muted" />

      {/* Content skeleton */}
      <div className="p-3 space-y-2">
        <div className="h-4 w-full animate-pulse rounded bg-muted" />
        <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
        <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
        <div className="h-8 w-full animate-pulse rounded bg-muted" />
      </div>
    </div>
  )
}
