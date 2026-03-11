'use client'

import { useSession } from '@/lib/auth-client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ShieldCheck } from 'lucide-react'

export function AdminSettingsLink() {
  const { data: session } = useSession()
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    if (!session?.user?.email) return

    fetch('/api/admin/check')
      .then((res) => res.json())
      .then((data) => setIsAdmin(data.isAdmin === true))
      .catch(() => setIsAdmin(false))
  }, [session?.user?.email])

  if (!isAdmin) return null

  return (
    <section>
      <h2 className="text-lg font-semibold mb-4">Administration</h2>
      <Link
        href="/admin/access-requests"
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ShieldCheck className="size-4" />
        Access Requests
      </Link>
    </section>
  )
}
