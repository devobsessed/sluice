'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { usePageTitle } from '@/components/layout/PageTitleContext'
import { Button } from '@/components/ui/button'
import { RefreshCw } from 'lucide-react'
import { FollowChannelInput } from '@/components/discovery/FollowChannelInput'
import { DiscoveryVideoGrid } from '@/components/discovery/DiscoveryVideoGrid'
import { ChannelFilterDropdown } from '@/components/discovery/ChannelFilterDropdown'
import { ContentTypeFilter, type ContentTypeValue } from '@/components/discovery/ContentTypeFilter'
import type { DiscoveryVideo } from '@/components/discovery/DiscoveryVideoCard'
import { FilterPillBar } from '@/components/filters/FilterPillBar'
import type { FilterPill } from '@/components/filters/FilterPillBar'
import { FloatingBatchBar } from '@/components/discovery/FloatingBatchBar'
import { useURLParams } from '@/hooks/useURLParams'
import { buildReturnTo } from '@/lib/navigation'
import { useBatchAdd } from '@/hooks/useBatchAdd'

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

interface DiscoveryVideoWithBank extends DiscoveryVideo {
  bankVideoId: number | null
  focusAreas: { id: number; name: string; color: string | null }[]
}

export function DiscoveryContent() {
  const { setPageTitle } = usePageTitle()
  const { searchParams, updateParams } = useURLParams()
  const [channels, setChannels] = useState<Channel[]>([])
  const [discoveryVideos, setDiscoveryVideos] = useState<DiscoveryVideo[]>([])
  const [focusAreaMap, setFocusAreaMap] = useState<Record<string, { id: number; name: string; color: string }[]>>({})
  const [bankIdMap, setBankIdMap] = useState<Record<string, number>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingVideos, setIsLoadingVideos] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Fetch all discovery data in a single call
  const fetchDiscoveryData = useCallback(async () => {
    setIsLoading(true)
    try {
      const response = await fetch('/api/discovery')
      if (!response.ok) {
        const data = await response.json()
        setError(data.error || 'Failed to load discovery data')
        setChannels([])
        setDiscoveryVideos([])
        setBankIdMap({})
        setFocusAreaMap({})
        return
      }

      const data = await response.json()
      setChannels(data.channels)

      const fetchedVideos: DiscoveryVideoWithBank[] = data.videos
      setDiscoveryVideos(fetchedVideos)

      // Build maps from the single response
      const newBankIdMap: Record<string, number> = {}
      const newFocusAreaMap: Record<string, { id: number; name: string; color: string }[]> = {}

      for (const video of fetchedVideos) {
        if (video.bankVideoId !== null && video.bankVideoId !== undefined) {
          newBankIdMap[video.youtubeId] = video.bankVideoId
        }
        if (video.focusAreas && video.focusAreas.length > 0) {
          newFocusAreaMap[video.youtubeId] = video.focusAreas.map(
            (fa: { id: number; name: string; color: string | null }) => ({
              id: fa.id,
              name: fa.name,
              color: fa.color ?? '',
            })
          )
        }
      }

      setBankIdMap(newBankIdMap)
      setFocusAreaMap(newFocusAreaMap)
    } catch {
      setError('Failed to load discovery data')
    } finally {
      setIsLoading(false)
      setIsLoadingVideos(false)
    }
  }, [])

  // Batch add hook
  const { startBatch, batchStatus, isRunning } = useBatchAdd({
    onComplete: () => {
      fetchDiscoveryData()
      setSelectedIds(new Set())
    },
  })

  // Compute returnTo for navigation
  const returnTo = buildReturnTo('/discovery', searchParams)

  // Read filters from URL params with validation
  const selectedChannelId = searchParams.get('channel') || null

  // Validate content type
  const VALID_DISCOVERY_TYPES = ['all', 'saved', 'not-saved'] as const
  const rawType = searchParams.get('type')
  const contentType = (rawType && VALID_DISCOVERY_TYPES.includes(rawType as ContentTypeValue))
    ? (rawType as ContentTypeValue)
    : 'all'

  // Validate page number (ensure at least 1)
  const currentPage = Math.max(1, Number(searchParams.get('page')) || 1)

  useEffect(() => {
    setPageTitle({ title: 'Discovery' })
  }, [setPageTitle])

  // Initial load: fetch all discovery data in one request
  useEffect(() => {
    fetchDiscoveryData()
  }, [fetchDiscoveryData])

  const handleChannelFollowed = async (newChannel: Channel) => {
    setChannels((prev) => [newChannel, ...prev])
    // Refresh RSS cache then re-fetch all discovery data so new channel videos appear immediately
    try {
      await fetch('/api/channels/videos/refresh', { method: 'POST' })
    } catch {
      // Non-fatal: cached data will still load
    }
    await fetchDiscoveryData()
  }

  const handleRefresh = async () => {
    // Trigger fresh RSS fetch into DB cache, then reload from DB
    setIsLoadingVideos(true)
    try {
      await fetch('/api/channels/videos/refresh', { method: 'POST' })
    } catch {
      // Non-fatal: will still reload whatever is cached
    }
    await fetchDiscoveryData()
  }

  const handleToggleSelect = useCallback((youtubeId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(youtubeId)) next.delete(youtubeId)
      else next.add(youtubeId)
      return next
    })
  }, [])

  const handleBatchAdd = useCallback(() => {
    const videosToAdd = discoveryVideos.filter(v => selectedIds.has(v.youtubeId) && !v.inBank)
    startBatch(videosToAdd)
  }, [selectedIds, discoveryVideos, startBatch])

  const handleChannelChange = (channelId: string | null) => {
    updateParams({ channel: channelId, page: null })
    setSelectedIds(new Set())
  }

  const handleContentTypeChange = (type: ContentTypeValue) => {
    updateParams({ type: type === 'all' ? null : type, page: null })
    setSelectedIds(new Set())
  }

  const handlePageChange = (page: number) => {
    updateParams({ page: page <= 1 ? null : String(page) }, 'push')
  }

  // Build filter pills array
  const filterPills = useMemo(() => {
    const pills: FilterPill[] = []
    if (selectedChannelId) {
      const channelName = channels.find(c => c.channelId === selectedChannelId)?.name ?? selectedChannelId
      pills.push({
        label: 'Creator',
        value: channelName,
        onDismiss: () => updateParams({ channel: null, page: null }),
      })
    }
    if (contentType !== 'all') {
      const typeLabel = contentType === 'saved' ? 'Saved' : 'Not Saved'
      pills.push({
        label: 'Status',
        value: typeLabel,
        onDismiss: () => updateParams({ type: null, page: null }),
      })
    }
    return pills
  }, [selectedChannelId, channels, contentType, updateParams])

  // Clear all filters handler
  const handleClearAllFilters = useCallback(() => {
    updateParams({ channel: null, type: null, page: null })
  }, [updateParams])

  // Filter videos by selected channel and content type
  const filteredVideos = useMemo(() => {
    let result = discoveryVideos

    // Apply channel filter
    if (selectedChannelId !== null) {
      result = result.filter((video) => video.channelId === selectedChannelId)
    }

    // Apply content type filter
    if (contentType === 'not-saved') {
      result = result.filter((video) => !video.inBank)
    } else if (contentType === 'saved') {
      result = result.filter((video) => video.inBank)
    }

    return result
  }, [discoveryVideos, selectedChannelId, contentType])

  if (isLoading) {
    // Show skeleton grid while loading initial data
    return (
      <div className="p-4 sm:p-6 space-y-6">
        <div className="flex flex-col sm:flex-row items-start gap-3">
          <div className="flex-1 w-full">
            <div className="h-10 w-full animate-pulse rounded bg-muted" />
          </div>
        </div>
        <DiscoveryVideoGrid videos={[]} isLoading={true} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <p className="text-red-600 dark:text-red-400">Failed to load channels. Please try again.</p>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header with follow input, filter, and refresh button */}
      <div className="flex flex-col sm:flex-row items-start gap-3">
        <div className="flex-1 w-full">
          <FollowChannelInput onChannelFollowed={handleChannelFollowed} />
        </div>
        {channels.length > 0 && (
          <>
            <ChannelFilterDropdown
              channels={channels}
              selectedChannelId={selectedChannelId}
              onChannelChange={handleChannelChange}
            />
            <ContentTypeFilter selected={contentType} onChange={handleContentTypeChange} />
            <Button
              variant="outline"
              size="default"
              onClick={handleRefresh}
              aria-label="Refresh all channels"
              className="w-full sm:w-auto"
            >
              <RefreshCw className="size-4" />
              Refresh
            </Button>
          </>
        )}
      </div>

      {/* Active filter pills */}
      <FilterPillBar
        pills={filterPills}
        onClearAll={handleClearAllFilters}
        className="mb-4"
      />

      {/* Empty state or video grid */}
      {channels.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="max-w-md space-y-4">
            <div className="text-6xl mb-4">🔭</div>
            <p className="text-lg font-medium text-foreground">
              No channels followed yet
            </p>
            <p className="text-muted-foreground">
              Follow a YouTube channel to discover new videos. Try these examples:
            </p>
            <div className="text-sm text-muted-foreground space-y-1">
              <p className="font-mono">https://youtube.com/@fireship</p>
              <p className="font-mono">https://youtube.com/@ThePrimeagen</p>
              <p className="font-mono">https://youtube.com/@TomScottGo</p>
            </div>
          </div>
        </div>
      ) : (
        <DiscoveryVideoGrid
          videos={filteredVideos}
          isLoading={isLoadingVideos}
          focusAreaMap={focusAreaMap}
          bankIdMap={bankIdMap}
          currentPage={currentPage}
          onPageChange={handlePageChange}
          returnTo={returnTo}
          selectedIds={selectedIds}
          onToggleSelect={handleToggleSelect}
          batchStatus={batchStatus}
        />
      )}

      {/* Floating batch action bar */}
      <FloatingBatchBar
        selectedCount={selectedIds.size}
        onAdd={handleBatchAdd}
        onClear={() => setSelectedIds(new Set())}
        isAdding={isRunning}
      />
    </div>
  )
}
