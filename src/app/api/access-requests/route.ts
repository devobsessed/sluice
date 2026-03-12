import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { accessRequests } from '@/lib/db/schema'
import { eq, desc } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { isAdmin } from '@/lib/admin'

const accessRequestSchema = z.object({
  name: z.preprocess(
    (v) => (typeof v === 'string' ? v : ''),
    z.string().trim().min(1, 'Name is required'),
  ),
  email: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim().toLowerCase() : ''),
    z.string().min(1, 'Email is required').email('Please enter a valid email address'),
  ),
  message: z.string().trim().optional(),
})

export async function GET(request: Request) {
  if (process.env.NODE_ENV !== 'development') {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!isAdmin(session.user.email)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const url = new URL(request.url)
  const status = url.searchParams.get('status')

  try {
    const query = db
      .select()
      .from(accessRequests)
      .orderBy(desc(accessRequests.updatedAt))

    const rows = status
      ? await query.where(eq(accessRequests.status, status))
      : await query

    return NextResponse.json({ data: rows })
  } catch (error) {
    console.error('Failed to fetch access requests:', error)
    return NextResponse.json(
      { error: 'Failed to fetch access requests' },
      { status: 500 },
    )
  }
}

export async function POST(request: Request) {
  try {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Malformed JSON' }, { status: 400 })
    }

    const parsed = accessRequestSchema.safeParse(body)
    if (!parsed.success) {
      const firstError = parsed.error.issues[0]?.message ?? 'Invalid request'
      return NextResponse.json({ error: firstError }, { status: 400 })
    }

    const { name, email, message } = parsed.data

    // Check for existing request (pending or approved)
    const [existing] = await db
      .select({ id: accessRequests.id, status: accessRequests.status })
      .from(accessRequests)
      .where(eq(accessRequests.email, email))
      .limit(1)

    if (existing) {
      if (existing.status === 'approved') {
        return NextResponse.json(
          { error: 'This email already has access. Try signing in.' },
          { status: 409 },
        )
      }
      if (existing.status === 'pending') {
        return NextResponse.json(
          { error: 'A request for this email is already pending.' },
          { status: 409 },
        )
      }
      // If denied, allow re-request by updating the existing row
      await db
        .update(accessRequests)
        .set({ name, message: message ?? null, status: 'pending', updatedAt: new Date() })
        .where(eq(accessRequests.id, existing.id))

      return NextResponse.json({ id: existing.id, email }, { status: 201 })
    }

    const [inserted] = await db
      .insert(accessRequests)
      .values({ name, email, message: message ?? null })
      .returning({ id: accessRequests.id, email: accessRequests.email })

    return NextResponse.json({ id: inserted!.id, email: inserted!.email }, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}
