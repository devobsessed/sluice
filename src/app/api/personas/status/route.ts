import { db, videos, personas } from '@/lib/db'
import { NextResponse } from 'next/server'
import { sql, isNotNull } from 'drizzle-orm'
import { PERSONA_THRESHOLD } from '@/lib/personas/service'
import { startApiTimer } from '@/lib/api-timing'
import { requireSession } from '@/lib/auth-guards'

export async function GET() {
  const denied = await requireSession()
  if (denied) return denied
  const timer = startApiTimer('/api/personas/status', 'GET')
  try {
    // Steps 1 & 2 run in parallel — independent queries with no shared state
    const [channelCounts, allPersonas] = await Promise.all([
      // Count videos per channel (simple GROUP BY on one column)
      db
        .select({
          channelName: videos.channel,
          transcriptCount: sql<number>`count(${videos.id})::int`,
        })
        .from(videos)
        .where(isNotNull(videos.channel))
        .groupBy(videos.channel),
      // Get all personas (small table, typically < 20 rows)
      db
        .select({
          id: personas.id,
          channelName: personas.channelName,
          createdAt: personas.createdAt,
          name: personas.name,
          expertiseTopics: personas.expertiseTopics,
        })
        .from(personas),
    ])

    // Step 3: Merge in application code
    const personaMap = new Map(
      allPersonas.map(p => [p.channelName, p])
    )

    const channelsWithStatus = channelCounts.map(ch => {
      const persona = personaMap.get(ch.channelName!)
      return {
        channelName: ch.channelName,
        transcriptCount: ch.transcriptCount,
        personaId: persona?.id ?? null,
        personaCreatedAt: persona?.createdAt ?? null,
        personaName: persona?.name ?? null,
        expertiseTopics: persona?.expertiseTopics ?? null,
      }
    })

    // Sort: active personas first, then by transcript count descending
    const sortedChannels = channelsWithStatus.sort((a, b) => {
      // Active personas first
      if (a.personaId !== null && b.personaId === null) return -1
      if (a.personaId === null && b.personaId !== null) return 1

      // Then by transcript count descending
      return b.transcriptCount - a.transcriptCount
    })

    timer.end(200)
    return NextResponse.json({
      channels: sortedChannels,
      threshold: PERSONA_THRESHOLD,
    })
  } catch (error) {
    console.error('Error fetching persona status:', error)
    timer.end(500)
    return NextResponse.json(
      { error: 'Failed to fetch persona status' },
      { status: 500 }
    )
  }
}
