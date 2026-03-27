import { db, channels, discoveryVideos } from '@/lib/db'
import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { startApiTimer } from '@/lib/api-timing'
import { requireSession } from '@/lib/auth-guards'

const channelIdSchema = z.string().regex(/^[1-9]\d*$/, 'Channel ID must be a positive integer')

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireSession()
  if (denied) return denied
  const timer = startApiTimer('/api/channels/[id]', 'DELETE')
  try {
    const { id } = await params

    // Validate channel ID
    const idValidation = channelIdSchema.safeParse(id)
    if (!idValidation.success) {
      timer.end(400)
      return NextResponse.json(
        { error: idValidation.error.issues[0]?.message || 'Invalid channel ID' },
        { status: 400 }
      )
    }

    const channelRowId = parseInt(id, 10)

    // Fetch the channel first to check existence and get YouTube channelId
    const existing = await db
      .select()
      .from(channels)
      .where(eq(channels.id, channelRowId))

    if (!existing[0]) {
      timer.end(404)
      return NextResponse.json({ error: 'Channel not found' }, { status: 404 })
    }

    const youtubeChannelId = existing[0].channelId

    // Atomic delete: channel row + discovery_videos cleanup in a transaction
    const deleted = await db.transaction(async (tx) => {
      const [deletedChannel] = await tx
        .delete(channels)
        .where(eq(channels.id, channelRowId))
        .returning()

      await tx
        .delete(discoveryVideos)
        .where(eq(discoveryVideos.channelId, youtubeChannelId))

      return deletedChannel
    })

    timer.end(200)
    return NextResponse.json({
      success: true,
      channel: deleted,
    })
  } catch (error) {
    console.error('Error unfollowing channel:', error)
    timer.end(500)
    return NextResponse.json({ error: 'Failed to unfollow channel' }, { status: 500 })
  }
}
