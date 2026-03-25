'use client';

import React from 'react'
import { VideoCard, VideoCardSkeleton } from '@/components/videos/VideoCard';
import type { FocusArea } from '@/lib/db/schema';
import type { VideoListItem } from '@/lib/db/search';

interface VideoGridProps {
  videos: VideoListItem[];
  isLoading?: boolean;
  isLoadingMore?: boolean;
  emptyMessage?: string;
  emptyHint?: string;
  focusAreaMap?: Record<number, Pick<FocusArea, 'id' | 'name' | 'color'>[]>;
  allFocusAreas?: FocusArea[];
  onToggleFocusArea?: (videoId: number, focusAreaId: number) => void;
  returnTo?: string;
  summaryMap?: Record<number, string>;
  sentinelRef?: React.RefObject<HTMLDivElement | null>;
}

export function VideoGrid({
  videos,
  isLoading = false,
  isLoadingMore = false,
  emptyMessage,
  emptyHint,
  focusAreaMap,
  allFocusAreas,
  onToggleFocusArea,
  returnTo,
  summaryMap,
  sentinelRef,
}: VideoGridProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {Array.from({ length: 10 }).map((_, i) => (
          <VideoCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (videos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-lg font-medium text-muted-foreground">
          {emptyMessage || 'No results found'}
        </p>
        <p className="text-sm text-muted-foreground">
          {emptyHint || 'Try adjusting your search terms'}
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {videos.map((video) => (
          <div
            key={video.id}
            className="animate-in fade-in duration-300"
          >
            <VideoCard
              video={video}
              focusAreas={focusAreaMap?.[video.id]}
              allFocusAreas={allFocusAreas}
              onToggleFocusArea={onToggleFocusArea ? (faId) => onToggleFocusArea(video.id, faId) : undefined}
              returnTo={returnTo}
              insightSummary={summaryMap?.[video.id]}
            />
          </div>
        ))}
      </div>
      {/* Skeleton cards for next page while loading */}
      {isLoadingMore && (
        <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {Array.from({ length: 4 }).map((_, i) => (
            <VideoCardSkeleton key={`loading-more-${i}`} />
          ))}
        </div>
      )}
      {/* Invisible sentinel for IntersectionObserver */}
      <div ref={sentinelRef} className="h-1" aria-hidden="true" />
    </>
  )
}
