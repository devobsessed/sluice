import { NextResponse } from 'next/server'
import { refreshDiscoveryVideos } from '@/lib/automation/rss'
import { startApiTimer } from '@/lib/api-timing'
import { requireSession } from '@/lib/auth-guards'

export async function POST(_request: Request): Promise<NextResponse> {
  const denied = await requireSession()
  if (denied) return denied

  const timer = startApiTimer('/api/channels/videos/refresh', 'POST')
  try {
    const result = await refreshDiscoveryVideos()
    timer.end(200, { videoCount: result.videoCount, channelCount: result.channelCount })
    return NextResponse.json(result)
  } catch (error) {
    console.error('Failed to refresh discovery videos:', error)
    timer.end(500)
    return NextResponse.json(
      { error: 'Failed to refresh discovery videos' },
      { status: 500 }
    )
  }
}

/**
 * Allow longer execution for RSS fetching across many channels.
 * Requires Vercel Pro plan.
 */
export const maxDuration = 30
