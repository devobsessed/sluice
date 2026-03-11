import type { Metadata } from 'next'
import { ThemeToggle } from '@/components/settings/ThemeToggle'
import { AdminSettingsLink } from '@/components/admin/AdminSettingsLink'

export const metadata: Metadata = {
  title: 'Settings | Sluice',
}

export default function Settings() {
  return (
    <div className="p-4 sm:p-6">
      <h1 className="text-xl sm:text-2xl font-semibold mb-2">Settings</h1>
      <p className="text-muted-foreground mb-8">
        Manage your preferences and application settings.
      </p>

      <div className="space-y-6">
        <section>
          <h2 className="text-lg font-semibold mb-4">Appearance</h2>
          <ThemeToggle />
        </section>

        <AdminSettingsLink />
      </div>
    </div>
  )
}
