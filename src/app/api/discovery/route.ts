import { db, channels, discoveryVideos, videos, videoFocusAreas, focusAreas } from '@/lib/db'
import { NextResponse } from 'next/server'
import { desc, inArray, eq, sql } from 'drizzle-orm'
import { startApiTimer } from '@/lib/api-timing'
import { requireSession } from '@/lib/auth-guards'

interface DiscoveryVideoResponse {
  youtubeId: string
  title: string
  channelId: string
  channelName: string
  publishedAt: string | null
  description: string
  inBank: boolean
  bankVideoId: number | null
  focusAreas: { id: number; name: string; color: string | null }[]
}

export async function GET() {
  const denied = await requireSession()
  if (denied) return denied
  const timer = startApiTimer('/api/discovery', 'GET')
  try {
    // Parallel fetch: channels + discovery videos
    const [allChannels, cached] = await Promise.all([
      db.select().from(channels),
      db.select().from(discoveryVideos).orderBy(sql`${discoveryVideos.publishedAt} DESC NULLS LAST`),
    ])

    // If no cached videos, return channels with empty videos array
    if (cached.length === 0) {
      timer.end(200, { channels: allChannels.length, videos: 0 })
      return NextResponse.json({ channels: allChannels, videos: [] })
    }

    // Check which videos are already in the knowledge bank
    const youtubeIds = cached.map((v) => v.youtubeId)
    const videosInBank = await db
      .select({ youtubeId: videos.youtubeId, id: videos.id })
      .from(videos)
      .where(inArray(videos.youtubeId, youtubeIds))

    const bankMap = new Map(videosInBank.map((v) => [v.youtubeId, v.id]))

    // Fetch focus areas for in-bank videos in one query
    const bankVideoIds = videosInBank.map((v) => v.id)
    const focusAreaMap: Record<number, { id: number; name: string; color: string | null }[]> = {}

    if (bankVideoIds.length > 0) {
      const assignments = await db
        .select({
          videoId: videoFocusAreas.videoId,
          id: focusAreas.id,
          name: focusAreas.name,
          color: focusAreas.color,
        })
        .from(videoFocusAreas)
        .innerJoin(focusAreas, eq(videoFocusAreas.focusAreaId, focusAreas.id))
        .where(inArray(videoFocusAreas.videoId, bankVideoIds))

      for (const row of assignments) {
        const list = focusAreaMap[row.videoId] ?? (focusAreaMap[row.videoId] = [])
        list.push({ id: row.id, name: row.name, color: row.color })
      }
    }

    // Map to response format
    const videoResponse: DiscoveryVideoResponse[] = cached.map((video) => {
      const bankVideoId = bankMap.get(video.youtubeId)
      return {
        youtubeId: video.youtubeId,
        title: video.title,
        channelId: video.channelId,
        channelName: video.channelName,
        publishedAt: video.publishedAt ? video.publishedAt.toISOString() : null,
        description: video.description,
        inBank: bankVideoId !== undefined,
        bankVideoId: bankVideoId ?? null,
        focusAreas: bankVideoId !== undefined ? (focusAreaMap[bankVideoId] ?? []) : [],
      }
    })

    timer.end(200, { channels: allChannels.length, videos: videoResponse.length })
    return NextResponse.json({ channels: allChannels, videos: videoResponse })
  } catch (error) {
    console.error('Failed to fetch discovery data:', error)
    timer.end(500)
    return NextResponse.json(
      { error: 'Failed to fetch discovery data' },
      { status: 500 }
    )
  }
}
