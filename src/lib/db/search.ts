import { db as defaultDb } from './index'
import { videos, videoFocusAreas, type Video } from './schema'
import { desc, or, ilike, sql, lt, and, eq, inArray, type SQL } from 'drizzle-orm'

/**
 * Columns for video list views — everything except transcript.
 * Transcript is 10-100KB per video and unused by list/card components.
 */
const videoListColumns = {
  id: videos.id,
  youtubeId: videos.youtubeId,
  sourceType: videos.sourceType,
  title: videos.title,
  channel: videos.channel,
  thumbnail: videos.thumbnail,
  duration: videos.duration,
  description: videos.description,
  createdAt: videos.createdAt,
  updatedAt: videos.updatedAt,
  publishedAt: videos.publishedAt,
}

/**
 * Type for video list views — all Video fields except transcript.
 * Components that display video cards/grids should use this type.
 */
export type VideoListItem = Omit<Video, 'transcript'>

/**
 * Opaque cursor for keyset pagination.
 * Encodes (createdAt, id) as base64url JSON.
 */
export interface PaginationCursor {
  createdAt: string // ISO 8601
  id: number
}

export interface PaginatedResult<T> {
  items: T[]
  hasMore: boolean
  nextCursor: string | null
}

export const DEFAULT_PAGE_SIZE = 24

function encodeCursor(cursor: PaginationCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url')
}

function decodeCursor(encoded: string): PaginationCursor | null {
  try {
    const json = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as unknown
    if (
      typeof json !== 'object' ||
      json === null ||
      typeof (json as Record<string, unknown>).createdAt !== 'string' ||
      typeof (json as Record<string, unknown>).id !== 'number'
    ) {
      return null
    }
    return json as PaginationCursor
  } catch {
    return null
  }
}

/**
 * Search videos using simple ILIKE pattern matching with optional cursor-based pagination.
 * Returns all columns EXCEPT transcript for payload size optimization.
 * @param query - Search query string
 * @param options - Pagination and filter options
 * @param dbInstance - Optional database instance (for testing)
 */
export async function searchVideos(
  query: string,
  options?: { cursor?: string, limit?: number, focusAreaId?: number | null, channel?: string | null },
  dbInstance = defaultDb,
): Promise<PaginatedResult<VideoListItem>> {
  const trimmed = query.trim()
  const limit = options?.limit ?? DEFAULT_PAGE_SIZE
  const cursor = options?.cursor ? decodeCursor(options.cursor) : null
  const focusAreaId = options?.focusAreaId ?? null
  const channel = options?.channel ?? null

  // Build conditions array
  const conditions: SQL[] = []

  // Search filter
  if (trimmed) {
    const pattern = `%${trimmed}%`
    conditions.push(
      or(
        ilike(videos.title, pattern),
        ilike(videos.channel, pattern),
      )!,
    )
  }

  // Cursor condition: (createdAt, id) < (cursorCreatedAt, cursorId) for DESC ordering
  if (cursor) {
    const cursorDate = new Date(cursor.createdAt)
    conditions.push(
      or(
        lt(videos.createdAt, cursorDate),
        and(
          eq(videos.createdAt, cursorDate),
          lt(videos.id, cursor.id),
        ),
      )!,
    )
  }

  // Channel filter
  if (channel) {
    conditions.push(eq(videos.channel, channel))
  }

  // Focus area filter: subquery for video IDs in the focus area
  if (focusAreaId !== null) {
    conditions.push(
      inArray(
        videos.id,
        dbInstance
          .select({ videoId: videoFocusAreas.videoId })
          .from(videoFocusAreas)
          .where(eq(videoFocusAreas.focusAreaId, focusAreaId)),
      ),
    )
  }

  // Fetch limit + 1 to determine hasMore
  const fetchLimit = limit + 1

  let queryBuilder = dbInstance.select(videoListColumns).from(videos)

  if (conditions.length > 0) {
    queryBuilder = queryBuilder.where(and(...conditions)) as typeof queryBuilder
  }

  const rows = await queryBuilder
    .orderBy(desc(videos.createdAt), desc(videos.id))
    .limit(fetchLimit)

  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows

  let nextCursor: string | null = null
  if (hasMore && items.length > 0) {
    const lastItem = items[items.length - 1]!
    nextCursor = encodeCursor({
      createdAt: lastItem.createdAt.toISOString(),
      id: lastItem.id,
    })
  }

  return { items, hasMore, nextCursor }
}

/**
 * Get statistics about the video knowledge bank.
 * Single query combining count, total duration, and unique channels.
 * @param dbInstance - Optional database instance (for testing)
 */
export async function getVideoStats(dbInstance = defaultDb): Promise<{
  count: number
  totalHours: number
  channels: number
}> {
  const result = await dbInstance.select({
    count: sql<number>`count(*)`,
    totalDuration: sql<number>`coalesce(sum(duration), 0)`,
    channels: sql<number>`count(distinct channel)`,
  }).from(videos)

  const row = result[0]

  return {
    count: Number(row?.count ?? 0),
    totalHours: Math.round((Number(row?.totalDuration ?? 0) / 3600) * 10) / 10,
    channels: Number(row?.channels ?? 0),
  }
}

/**
 * Get all distinct channels (creators) with their video counts
 * Returns results sorted by video count descending
 * Filters out null channels (transcript-only videos)
 * @param dbInstance - Optional database instance (for testing)
 */
export async function getDistinctChannels(dbInstance = defaultDb): Promise<Array<{ channel: string; videoCount: number }>> {
  const results = await dbInstance
    .select({
      channel: videos.channel,
      videoCount: sql<number>`count(*)`,
    })
    .from(videos)
    .groupBy(videos.channel)
    .orderBy(sql`count(*) desc`)

  return results
    .filter(r => r.channel !== null)
    .map(r => ({
      channel: r.channel!,
      videoCount: Number(r.videoCount),
    }))
}
