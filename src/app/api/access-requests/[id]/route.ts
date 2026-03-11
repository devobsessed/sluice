import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { db } from '@/lib/db'
import { accessRequests } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
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
  const id = parseInt(idStr, 10)
  if (isNaN(id)) {
    return NextResponse.json({ error: 'Invalid request ID' }, { status: 400 })
  }

  const body = await request.json()
  const parsed = PatchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid status' },
      { status: 400 },
    )
  }

  try {
    const [updated] = await db
      .update(accessRequests)
      .set({
        status: parsed.data.status,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(accessRequests.id, id),
          eq(accessRequests.status, 'pending'),
        ),
      )
      .returning()

    if (!updated) {
      return NextResponse.json(
        { error: 'Request not found or not in pending status' },
        { status: 400 },
      )
    }

    return NextResponse.json({ data: updated })
  } catch (error) {
    console.error('Failed to update access request:', error)
    return NextResponse.json(
      { error: 'Failed to update access request' },
      { status: 500 },
    )
  }
}
