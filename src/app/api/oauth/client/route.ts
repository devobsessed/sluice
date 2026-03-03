import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db, oauthClient } from '@/lib/db'
import { startApiTimer } from '@/lib/api-timing'
import { requireSession } from '@/lib/auth-guards'

export async function GET(request: Request) {
  const denied = await requireSession()
  if (denied) return denied

  const timer = startApiTimer('/api/oauth/client', 'GET')

  const { searchParams } = new URL(request.url)
  const clientId = searchParams.get('client_id')

  if (!clientId || clientId.trim() === '') {
    timer.end(400)
    return NextResponse.json(
      { error: 'Missing required query parameter: client_id' },
      { status: 400 },
    )
  }

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
