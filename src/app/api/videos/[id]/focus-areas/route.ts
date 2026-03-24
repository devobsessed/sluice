import { db, videos, focusAreas, videoFocusAreas } from '@/lib/db'
import { eq, and } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { startApiTimer } from '@/lib/api-timing'
import { requireSession } from '@/lib/auth-guards'

const assignFocusAreaSchema = z.object({
  focusAreaId: z.number().int().positive('Focus area ID is required'),
})

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireSession()
  if (denied) return denied
  const timer = startApiTimer('/api/videos/[id]/focus-areas', 'GET')
  try {
    const { id: idParam } = await params
    const videoId = parseInt(idParam, 10)

    if (isNaN(videoId)) {
      timer.end(400)
      return NextResponse.json({ error: 'Invalid video ID' }, { status: 400 })
    }

    // Check if video exists
    const [video] = await db.select({ id: videos.id }).from(videos).where(eq(videos.id, videoId)).limit(1)

    if (!video) {
      timer.end(404)
      return NextResponse.json({ error: 'Video not found' }, { status: 404 })
    }

    // Get focus areas for this video
    const videoFocusAreasResult = await db
      .select({
        id: focusAreas.id,
        name: focusAreas.name,
        color: focusAreas.color,
        createdAt: focusAreas.createdAt,
      })
      .from(videoFocusAreas)
      .innerJoin(focusAreas, eq(videoFocusAreas.focusAreaId, focusAreas.id))
      .where(eq(videoFocusAreas.videoId, videoId))

    timer.end(200)
    return NextResponse.json({ focusAreas: videoFocusAreasResult }, { status: 200 })
  } catch (error) {
    console.error('Error fetching video focus areas:', error)
    timer.end(500)
    return NextResponse.json(
      { error: 'Failed to fetch focus areas. Please try again.' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireSession()
  if (denied) return denied
  const timer = startApiTimer('/api/videos/[id]/focus-areas', 'POST')
  try {
    const { id: idParam } = await params
    const videoId = parseInt(idParam, 10)

    if (isNaN(videoId)) {
      timer.end(400)
      return NextResponse.json({ error: 'Invalid video ID' }, { status: 400 })
    }

    const body = await request.json()

    const validationResult = assignFocusAreaSchema.safeParse(body)

    if (!validationResult.success) {
      const firstError = validationResult.error.issues[0]
      timer.end(400)
      return NextResponse.json(
        { error: firstError?.message || 'Invalid request data' },
        { status: 400 }
      )
    }

    const { focusAreaId } = validationResult.data

    // Check if video exists
    const [video] = await db.select({ id: videos.id }).from(videos).where(eq(videos.id, videoId)).limit(1)

    if (!video) {
      timer.end(404)
      return NextResponse.json({ error: 'Video not found' }, { status: 404 })
    }

    // Check if focus area exists
    const [focusArea] = await db
      .select()
      .from(focusAreas)
      .where(eq(focusAreas.id, focusAreaId))
      .limit(1)

    if (!focusArea) {
      timer.end(404)
      return NextResponse.json({ error: 'Focus area not found' }, { status: 404 })
    }

    // Check if assignment already exists
    const [existingAssignment] = await db
      .select()
      .from(videoFocusAreas)
      .where(
        and(
          eq(videoFocusAreas.videoId, videoId),
          eq(videoFocusAreas.focusAreaId, focusAreaId)
        )
      )
      .limit(1)

    if (existingAssignment) {
      timer.end(409)
      return NextResponse.json(
        { error: 'Focus area already assigned to this video' },
        { status: 409 }
      )
    }

    // Create assignment
    await db.insert(videoFocusAreas).values({
      videoId,
      focusAreaId,
    })

    timer.end(201)
    return new Response(null, { status: 201 })
  } catch (error) {
    console.error('Error assigning focus area:', error)
    timer.end(500)
    return NextResponse.json(
      { error: 'Failed to assign focus area. Please try again.' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireSession()
  if (denied) return denied
  const timer = startApiTimer('/api/videos/[id]/focus-areas', 'DELETE')
  try {
    const { id: idParam } = await params
    const videoId = parseInt(idParam, 10)

    if (isNaN(videoId)) {
      timer.end(400)
      return NextResponse.json({ error: 'Invalid video ID' }, { status: 400 })
    }

    const { searchParams } = new URL(request.url)
    const focusAreaIdParam = searchParams.get('focusAreaId')

    if (!focusAreaIdParam) {
      timer.end(400)
      return NextResponse.json(
        { error: 'focusAreaId query parameter is required' },
        { status: 400 }
      )
    }

    const focusAreaId = parseInt(focusAreaIdParam, 10)

    if (isNaN(focusAreaId)) {
      timer.end(400)
      return NextResponse.json({ error: 'Invalid focus area ID' }, { status: 400 })
    }

    // Check if video exists
    const [video] = await db.select({ id: videos.id }).from(videos).where(eq(videos.id, videoId)).limit(1)

    if (!video) {
      timer.end(404)
      return NextResponse.json({ error: 'Video not found' }, { status: 404 })
    }

    // Check if assignment exists
    const [existingAssignment] = await db
      .select()
      .from(videoFocusAreas)
      .where(
        and(
          eq(videoFocusAreas.videoId, videoId),
          eq(videoFocusAreas.focusAreaId, focusAreaId)
        )
      )
      .limit(1)

    if (!existingAssignment) {
      timer.end(404)
      return NextResponse.json(
        { error: 'Focus area not assigned to this video' },
        { status: 404 }
      )
    }

    // Delete assignment
    await db
      .delete(videoFocusAreas)
      .where(
        and(
          eq(videoFocusAreas.videoId, videoId),
          eq(videoFocusAreas.focusAreaId, focusAreaId)
        )
      )

    timer.end(204)
    return new Response(null, { status: 204 })
  } catch (error) {
    console.error('Error removing focus area:', error)
    timer.end(500)
    return NextResponse.json(
      { error: 'Failed to remove focus area. Please try again.' },
      { status: 500 }
    )
  }
}
