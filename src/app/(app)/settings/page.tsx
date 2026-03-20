import { Suspense } from 'react'
import type { Metadata } from 'next'
import { SettingsContent } from '@/components/settings/SettingsContent'

export const metadata: Metadata = {
  title: 'Settings | Sluice',
}

export default function Settings() {
  return (
    <Suspense>
      <SettingsContent />
    </Suspense>
  )
}
