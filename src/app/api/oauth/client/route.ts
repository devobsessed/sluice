import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db, oauthClient } from '@/lib/db'
import { startApiTimer } from '@/lib/api-timing'
import { requireSession } from '@/lib/auth-guards'

const querySchema = z.object({
  client_id: z.string().min(1, 'Missing required query parameter: client_id'),
})

export async function GET(request: Request) {
  const denied = await requireSession()
  if (denied) return denied

  const timer = startApiTimer('/api/oauth/client', 'GET')

  const { searchParams } = new URL(request.url)
  const parsed = querySchema.safeParse({
    client_id: searchParams.get('client_id') ?? '',
  })

  if (!parsed.success) {
    timer.end(400)
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request' },
      { status: 400 },
    )
  }

  const clientId = parsed.data.client_id

  try {
    const results = await db
      .select({
        name: oauthClient.name,
        icon: oauthClient.icon,
        uri: oauthClient.uri,
      })
      .from(oauthClient)
      .where(eq(oauthClient.clientId, clientId))
      .limit(1)

    if (results.length === 0) {
      timer.end(404)
      return NextResponse.json(
        { error: 'OAuth client not found' },
        { status: 404 },
      )
    }

    const client = results[0]

    timer.end(200)
    return NextResponse.json({
      data: {
        name: client?.name ?? null,
        icon: client?.icon ?? null,
        uri: client?.uri ?? null,
      },
    })
  } catch (error) {
    console.error('Error fetching OAuth client:', error)
    timer.end(500)
    return NextResponse.json(
      { error: 'Failed to fetch OAuth client' },
      { status: 500 },
    )
  }
}
