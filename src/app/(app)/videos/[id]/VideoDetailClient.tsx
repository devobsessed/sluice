'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { VideoPlayer } from '@/components/videos/VideoPlayer'
import { VideoMetadata } from '@/components/videos/VideoMetadata'
import { InsightsTabs } from '@/components/insights/InsightsTabs'
import { EmbedButton } from '@/components/video/EmbedButton'
import { FocusAreaAssignment } from '@/components/video/FocusAreaAssignment'
import { usePageTitle } from '@/components/layout/PageTitleContext'
import { parseReturnTo } from '@/lib/navigation'
import type { Video } from '@/lib/db/schema'

interface VideoDetailClientProps {
  video: Video
}

export function VideoDetailClient({ video: initialVideo }: VideoDetailClientProps) {
  const searchParams = useSearchParams()
  // Use server-provided video directly — no client-side fetch needed
  const video = initialVideo
  const [seekTime, setSeekTime] = useState<number | undefined>(undefined)

  // Parse returnTo parameter
  const returnTo = parseReturnTo(searchParams.get('returnTo'))

  // Set page title
  const { setPageTitle } = usePageTitle()

  useEffect(() => {
    const backHref = returnTo || '/'
    const backLabel = returnTo?.startsWith('/discovery') ? 'Discovery' : 'Knowledge Bank'

    setPageTitle({
      title: video.title,
      backHref,
      backLabel,
    })
  }, [video, setPageTitle, returnTo])

  // Handle seek from transcript
  const handleSeek = (seconds: number) => {
    setSeekTime(seconds)
  }

  return (
    <div className="p-4 sm:p-6">
      {/* Metadata row */}
      <VideoMetadata video={video} className="mb-6" />

      {/* Focus area assignment */}
      <FocusAreaAssignment videoId={video.id} />

      {/* Video player - only for YouTube videos */}
      {video.sourceType === 'youtube' && video.youtubeId && (
        <VideoPlayer
          youtubeId={video.youtubeId}
          seekTime={seekTime}
          className="mb-8"
        />
      )}

      {/* Embedding status and generation */}
      <EmbedButton
        videoId={video.id}
        hasTranscript={!!video.transcript}
      />

      {/* Tabs with Transcript and Insights */}
      <InsightsTabs video={video} onSeek={handleSeek} className="mt-8" />
    </div>
  )
}
