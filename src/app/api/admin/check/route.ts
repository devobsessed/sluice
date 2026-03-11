import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { isAdmin } from '@/lib/admin'

export async function GET() {
  if (process.env.NODE_ENV === 'development') {
    return NextResponse.json({ isAdmin: true })
  }

  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ isAdmin: false })
  }

  return NextResponse.json({ isAdmin: isAdmin(session.user.email) })
}
