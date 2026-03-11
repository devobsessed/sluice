import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { isAdmin } from '@/lib/admin'
import { AccessRequestsPanel } from '@/components/admin/AccessRequestsPanel'

export const metadata: Metadata = {
  title: 'Access Requests | Sluice',
}

export default async function AdminAccessRequestsPage() {
  if (process.env.NODE_ENV !== 'development') {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session || !isAdmin(session.user.email)) {
      redirect('/')
    }
  }

  return (
    <div className="p-4 sm:p-6">
      <AccessRequestsPanel />
    </div>
  )
}
