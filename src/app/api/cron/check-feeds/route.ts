import { NextResponse } from 'next/server'
import { fetchChannelFeed, refreshDiscoveryVideos } from '@/lib/automation/rss'
import { getChannelsForAutoFetch, updateChannelLastFetched } from '@/lib/automation/queries'
import { findNewVideos, createVideoFromRSS } from '@/lib/automation/delta'
import { verifyCronSecret } from '@/lib/auth-guards'
import { start } from 'workflow/api'
import { rssFeedWorkflow } from '@/workflows/rss-feed'

export async function GET(request: Request) {
  // Verify cron secret (timing-safe, rejects when env unset)
  const authResult = verifyCronSecret(request)
  if (!authResult.valid) {
    return authResult.response
  }

  try {
    const channels = await getChannelsForAutoFetch()
    let newVideosQueued = 0

    for (const channel of channels) {
      try {
        const feed = await fetchChannelFeed(channel.channelId)
        const newVideos = await findNewVideos(feed.videos)

        for (const video of newVideos) {
          const videoId = await createVideoFromRSS(video)
          await start(rssFeedWorkflow, [videoId, video.youtubeId])
          newVideosQueued++
        }

        await updateChannelLastFetched(channel.id)
      } catch (error) {
        // Log per-channel errors but continue processing other channels
        console.error(`Error processing channel ${channel.channelId}:`, error)
      }
    }

    // Refresh discovery_videos cache so Discovery page reflects latest RSS data
    try {
      await refreshDiscoveryVideos()
    } catch (error) {
      // Non-fatal: log but don't fail the cron job
      console.error('Error refreshing discovery videos cache:', error)
    }

    return NextResponse.json({ checked: channels.length, queued: newVideosQueued })
  } catch (error) {
    console.error('Error in check-feeds cron:', error)
    return NextResponse.json(
      { error: 'Failed to check feeds' },
      { status: 500 }
    )
  }
}

/**
 * Configure route segment for Vercel
 * maxDuration allows longer-running operations (requires Pro plan)
 */
export const maxDuration = 300
