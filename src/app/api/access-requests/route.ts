import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { accessRequests } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

const accessRequestSchema = z.object({
  name: z.preprocess(
    (v) => (typeof v === 'string' ? v : ''),
    z.string().min(1, 'Name is required').trim(),
  ),
  email: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim().toLowerCase() : ''),
    z.string().min(1, 'Email is required').email('Please enter a valid email address'),
  ),
  message: z.string().trim().optional(),
})

export async function POST(request: Request) {
  try {
    const body = await request.json()

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
