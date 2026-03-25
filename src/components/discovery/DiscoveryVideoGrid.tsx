'use client'

import { useMemo, useRef } from 'react'
import { DiscoveryVideoCard, DiscoveryVideoCardSkeleton, type DiscoveryVideo } from './DiscoveryVideoCard'
import { Pagination } from './Pagination'
import type { BatchItem } from '@/hooks/useBatchAdd'

interface DiscoveryVideoGridProps {
  videos: DiscoveryVideo[]
  isLoading?: boolean
  focusAreaMap?: Record<string, { id: number; name: string; color: string }[]>
  currentPage?: number
  onPageChange?: (page: number) => void
  returnTo?: string
  selectedIds?: Set<string>
  onToggleSelect?: (youtubeId: string) => void
  batchStatus?: Map<string, BatchItem>
  bankIdMap?: Record<string, number>
}

const VIDEOS_PER_PAGE = 24

export function DiscoveryVideoGrid({
  videos,
  isLoading = false,
  focusAreaMap,
  currentPage = 1,
  onPageChange,
  returnTo,
  selectedIds,
  onToggleSelect,
  batchStatus,
  bankIdMap,
}: DiscoveryVideoGridProps) {
  const gridRef = useRef<HTMLDivElement>(null)

  // Sort videos by publishedAt descending (newest first)
  const sortedVideos = useMemo(() => {
    return [...videos].sort((a, b) => {
      return (b.publishedAt ? new Date(b.publishedAt).getTime() : 0) - (a.publishedAt ? new Date(a.publishedAt).getTime() : 0)
    })
  }, [videos])

  // Calculate pagination
  const totalPages = Math.ceil(sortedVideos.length / VIDEOS_PER_PAGE)
  const startIndex = (currentPage - 1) * VIDEOS_PER_PAGE
  const endIndex = startIndex + VIDEOS_PER_PAGE
  const currentVideos = sortedVideos.slice(startIndex, endIndex)

  // Scroll to top of grid on page change
  const handlePageChange = (page: number) => {
    if (onPageChange) {
      onPageChange(page)
    }

    // Scroll to top of the page
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Loading state: 24 skeletons in grid
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {Array.from({ length: VIDEOS_PER_PAGE }).map((_, i) => (
          <DiscoveryVideoCardSkeleton key={i} />
        ))}
      </div>
    )
  }

  // Empty state: no videos
  if (sortedVideos.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-muted-foreground">Follow channels to discover videos</p>
      </div>
    )
  }

  return (
    <div ref={gridRef}>
      {/* Video Grid */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {currentVideos.map((video) => {
          const focusAreas = focusAreaMap?.[video.youtubeId]
          const itemBatchStatus = batchStatus?.get(video.youtubeId)?.status
          const bankVideoId = bankIdMap?.[video.youtubeId]

          return (
            <DiscoveryVideoCard
              key={video.youtubeId}
              video={video}
              focusAreas={focusAreas}
              returnTo={returnTo}
              selectable={!video.inBank}
              selected={selectedIds?.has(video.youtubeId)}
              onToggleSelect={onToggleSelect}
              batchStatus={itemBatchStatus}
              bankVideoId={bankVideoId}
            />
          )
        })}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-8">
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={handlePageChange}
          />
        </div>
      )}
    </div>
  )
}
