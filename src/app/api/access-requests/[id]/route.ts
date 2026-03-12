import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { db } from '@/lib/db'
import { accessRequests } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { isAdmin } from '@/lib/admin'
import { z } from 'zod'

const PatchSchema = z.object({
  status: z.enum(['approved', 'denied']),
})

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (process.env.NODE_ENV !== 'development') {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!isAdmin(session.user.email)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const { id: idStr } = await params
  const IdSchema = z.coerce.number().int().min(1).max(2147483647)
  const idParsed = IdSchema.safeParse(idStr)
  if (!idParsed.success) {
    return NextResponse.json({ error: 'Invalid request ID' }, { status: 400 })
  }
  const id = idParsed.data

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Malformed JSON' }, { status: 400 })
  }

  const parsed = PatchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid status' },
      { status: 400 },
    )
  }

  try {
    const [existing] = await db
      .select({ id: accessRequests.id, status: accessRequests.status })
      .from(accessRequests)
      .where(eq(accessRequests.id, id))
      .limit(1)

    if (!existing) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 })
    }

    if (existing.status !== 'pending') {
      return NextResponse.json(
        { error: 'Request is not in pending status' },
        { status: 400 },
      )
    }

    const [updated] = await db
      .update(accessRequests)
      .set({
        status: parsed.data.status,
        updatedAt: new Date(),
      })
      .where(eq(accessRequests.id, id))
      .returning()

    return NextResponse.json({ data: updated })
  } catch (error) {
    console.error('Failed to update access request:', error)
    return NextResponse.json(
      { error: 'Failed to update access request' },
      { status: 500 },
    )
  }
}
