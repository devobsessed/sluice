'use client'

import { useCallback, useEffect, useState } from 'react'
import { StatsHeader, StatsHeaderSkeleton } from '@/components/videos/StatsHeader'
import { VideoSearch } from '@/components/videos/VideoSearch'
import { VideoGrid } from '@/components/videos/VideoGrid'
import { EmptyState } from '@/components/videos/EmptyState'
import { SearchResults } from '@/components/search/SearchResults'
import { PersonaPanel } from '@/components/personas/PersonaPanel'
import { PersonaStatus } from '@/components/personas/PersonaStatus'
import { ChipBar } from '@/components/filters/ChipBar'
import { SortDropdown } from '@/components/filters/SortDropdown'
import { useSearch } from '@/hooks/useSearch'
import { useEnsemble } from '@/hooks/useEnsemble'
import { useChipFilters } from '@/hooks/useChipFilters'
import { useVideoSort } from '@/hooks/useVideoSort'
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll'
import { usePageTitle } from '@/components/layout/PageTitleContext'
import { useFocusArea } from '@/components/providers/FocusAreaProvider'
import { useURLParams } from '@/hooks/useURLParams'
import { buildReturnTo } from '@/lib/navigation'
import type { FocusArea } from '@/lib/db/schema'
import type { VideoListItem } from '@/lib/db/search'

interface VideoStats {
  count: number;
  totalHours: number;
  channels: number;
}

type FocusAreaMapEntry = Pick<FocusArea, 'id' | 'name' | 'color'>

interface ApiResponse {
  videos: VideoListItem[];
  stats?: VideoStats;  // only present on the first page (no cursor)
  focusAreaMap: Record<number, FocusAreaMapEntry[]>;
  summaryMap: Record<number, string>;
  hasMore: boolean;
  nextCursor: string | null;
}

export function KnowledgeBankContent() {
  const [videos, setVideos] = useState<VideoListItem[]>([]);
  const [stats, setStats] = useState<VideoStats | null>(null);
  const [isLoadingVideos, setIsLoadingVideos] = useState(true);
  const [focusAreaMap, setFocusAreaMap] = useState<Record<number, FocusAreaMapEntry[]>>({});
  const [summaryMap, setSummaryMap] = useState<Record<number, string>>({});
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasActivePersonas, setHasActivePersonas] = useState(false);

  // Set page title
  const { setPageTitle } = usePageTitle();

  // Focus area filtering
  const { selectedFocusAreaId, focusAreas } = useFocusArea();

  // URL state with validation
  const { searchParams, updateParams } = useURLParams()
  const urlQuery = searchParams.get('q') || ''
  const urlChannel = searchParams.get('channel') || ''

  // Compute returnTo for video detail navigation
  const returnTo = buildReturnTo('/', searchParams)

  // Use the search hook with URL query
  const { results, isLoading: isSearching } = useSearch({
    query: urlQuery,
    focusAreaId: selectedFocusAreaId
  })

  // Detect if query is a question (ends with ? and has 3+ words)
  const isQueryQuestion = urlQuery.trim().endsWith('?') && urlQuery.trim().split(/\s+/).filter(Boolean).length >= 3

  // Use ensemble hook when query is a question
  const { state: ensembleState, retry: retryEnsemble } = useEnsemble(isQueryQuestion ? urlQuery : null)

  // Set page title on mount
  useEffect(() => {
    setPageTitle({ title: 'Knowledge Bank' });
  }, [setPageTitle]);

  // Fetch a single page of videos - first page replaces state, subsequent pages append
  const fetchPage = useCallback(async (cursor?: string) => {
    const isFirstPage = !cursor
    if (isFirstPage) {
      setIsLoadingVideos(true)
    } else {
      setIsLoadingMore(true)
    }

    try {
      const params = new URLSearchParams()
      if (selectedFocusAreaId !== null) {
        params.set('focusAreaId', String(selectedFocusAreaId))
      }
      if (urlChannel) {
        params.set('channel', urlChannel)
      }
      if (cursor) {
        params.set('cursor', cursor)
      }
      const url = `/api/videos${params.toString() ? `?${params}` : ''}`
      const response = await fetch(url)

      if (!response.ok) {
        throw new Error('Failed to fetch videos')
      }

      const data: ApiResponse = await response.json()

      // Map dates from strings to Date objects
      const mappedVideos = data.videos.map((video) => ({
        ...video,
        createdAt: new Date(video.createdAt),
        updatedAt: new Date(video.updatedAt),
      }))

      if (isFirstPage) {
        setVideos(mappedVideos)
        setStats(data.stats ?? null)
        setFocusAreaMap(data.focusAreaMap || {})
        setSummaryMap(data.summaryMap || {})
      } else {
        setVideos(prev => [...prev, ...mappedVideos])
        setFocusAreaMap(prev => ({ ...prev, ...data.focusAreaMap }))
        setSummaryMap(prev => ({ ...prev, ...data.summaryMap }))
      }

      setHasMore(data.hasMore)
      setNextCursor(data.nextCursor)
    } catch (error) {
      console.error('Error fetching videos:', error)
      if (isFirstPage) {
        setVideos([])
        setStats({ count: 0, totalHours: 0, channels: 0 })
        setFocusAreaMap({})
        setSummaryMap({})
      }
      setHasMore(false)
      setNextCursor(null)
    } finally {
      if (isFirstPage) {
        setIsLoadingVideos(false)
      } else {
        setIsLoadingMore(false)
      }
    }
  }, [selectedFocusAreaId, urlChannel])

  // Reload page 1 when filters change
  useEffect(() => {
    setVideos([])
    setNextCursor(null)
    setHasMore(false)
    fetchPage()
  }, [fetchPage])

  // Load next page handler
  const handleLoadMore = useCallback(() => {
    if (nextCursor) {
      fetchPage(nextCursor)
    }
  }, [nextCursor, fetchPage])

  // Infinite scroll - observes sentinel at bottom of video grid
  const { sentinelRef } = useInfiniteScroll({
    hasMore,
    isLoading: isLoadingMore,
    onLoadMore: handleLoadMore,
  })

  // Chip filters — provides chips, activeIds, filtered videos, and toggle handler
  const { chips, activeIds, filteredVideos: chipFilteredVideos, handleToggle } = useChipFilters({
    videos,
    focusAreas,
    focusAreaMap,
  })

  // Sort — applies after chip filtering so changing chips doesn't reset sort
  const { sortedVideos, sortOption, setSortOption } = useVideoSort({
    videos: chipFilteredVideos,
  })

  // Search handler - updates URL query param
  const handleSearch = useCallback((q: string) => {
    updateParams({ q: q || null })
  }, [updateParams])

  // Optimistic toggle handler for focus area assignment
  const handleToggleFocusArea = useCallback(async (videoId: number, focusAreaId: number) => {
    const current = focusAreaMap[videoId] ?? []
    const isAssigned = current.some(fa => fa.id === focusAreaId)
    const area = focusAreas.find(fa => fa.id === focusAreaId)

    // Optimistic update
    if (isAssigned) {
      setFocusAreaMap(prev => ({
        ...prev,
        [videoId]: (prev[videoId] ?? []).filter(fa => fa.id !== focusAreaId),
      }))
    } else if (area) {
      setFocusAreaMap(prev => ({
        ...prev,
        [videoId]: [...(prev[videoId] ?? []), { id: area.id, name: area.name, color: area.color }],
      }))
    }

    try {
      if (isAssigned) {
        const response = await fetch(
          `/api/videos/${videoId}/focus-areas?focusAreaId=${focusAreaId}`,
          { method: 'DELETE' }
        )
        if (!response.ok) throw new Error('Failed to remove')
      } else {
        const response = await fetch(`/api/videos/${videoId}/focus-areas`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ focusAreaId }),
        })
        if (!response.ok && response.status !== 201) throw new Error('Failed to assign')
      }
    } catch (error) {
      console.error('Failed to toggle focus area:', error)
      // Revert optimistic update
      if (isAssigned && area) {
        setFocusAreaMap(prev => ({
          ...prev,
          [videoId]: [...(prev[videoId] ?? []), { id: area.id, name: area.name, color: area.color }],
        }))
      } else {
        setFocusAreaMap(prev => ({
          ...prev,
          [videoId]: (prev[videoId] ?? []).filter(fa => fa.id !== focusAreaId),
        }))
      }
    }
  }, [focusAreaMap, focusAreas])

  // Show empty state only when no videos exist at all (not during search)
  const showEmptyState = !isLoadingVideos && stats?.count === 0 && !urlQuery
  const showSearchResults = urlQuery.trim().length > 0
  const showPanel = isQueryQuestion && urlQuery.trim().length > 0

  return (
    <div className="p-4 sm:p-6">
      {/* Stats Header */}
      {isLoadingVideos && !stats ? (
        <StatsHeaderSkeleton />
      ) : stats && stats.count > 0 ? (
        <StatsHeader
          count={stats.count}
          totalHours={stats.totalHours}
          channels={stats.channels}
          className="mb-6"
        />
      ) : null}

      {/* Persona Status */}
      {!showEmptyState && (
        <div className="mb-4">
          <PersonaStatus onActivePersonasChange={setHasActivePersonas} />
        </div>
      )}

      {/* Empty State - only show when no videos exist at all */}
      {showEmptyState ? (
        <EmptyState />
      ) : (
        <>
          {/* Search Bar */}
          <div className="mb-4">
            <VideoSearch onSearch={handleSearch} defaultValue={urlQuery} />
            {hasActivePersonas && (
              <p className="mt-2 text-xs text-muted-foreground">
                Type keywords to search · End with ? to ask your personas
              </p>
            )}
          </div>

          {/* Toolbar: Chip Bar + Sort — visible when browsing (not searching) */}
          {!showSearchResults && videos.length > 0 && (
            <div className="mb-6 flex items-center gap-3">
              <ChipBar
                chips={chips}
                activeIds={activeIds}
                onToggle={handleToggle}
                className="min-w-0 flex-1"
              />
              <SortDropdown
                value={sortOption}
                onChange={setSortOption}
              />
            </div>
          )}

          {/* Persona Panel - shows above search results when question detected */}
          {showPanel && (
            <div className="mb-8">
              <PersonaPanel question={urlQuery} state={ensembleState} onRetry={retryEnsemble} />
            </div>
          )}

          {/* Content: either search results or video grid */}
          {showSearchResults ? (
            <SearchResults results={results} isLoading={isSearching} />
          ) : (
            <VideoGrid
              videos={sortedVideos}
              isLoading={isLoadingVideos}
              isLoadingMore={isLoadingMore}
              emptyMessage={
                activeIds.size > 0
                  ? 'No videos match these filters'
                  : selectedFocusAreaId
                    ? 'No videos in this focus area'
                    : undefined
              }
              emptyHint={
                activeIds.size > 0
                  ? 'Try removing some filters'
                  : selectedFocusAreaId
                    ? 'Assign videos from their detail page or use the tag icon on cards'
                    : undefined
              }
              focusAreaMap={focusAreaMap}
              allFocusAreas={focusAreas}
              onToggleFocusArea={handleToggleFocusArea}
              returnTo={returnTo || undefined}
              summaryMap={summaryMap}
              sentinelRef={sentinelRef}
            />
          )}
        </>
      )}
    </div>
  );
}
