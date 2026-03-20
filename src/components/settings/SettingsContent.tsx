'use client'

import { useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { ChevronRight } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { ThemeToggle } from '@/components/settings/ThemeToggle'
import { AdminSettingsLink } from '@/components/admin/AdminSettingsLink'
import { McpSetupGuide } from '@/components/settings/McpSetupGuide'

type View = 'landing' | 'guide'

export function SettingsContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const initialView = searchParams.get('view') === 'guide' ? 'guide' : 'landing'
  const [view, setView] = useState<View>(initialView)

  const navigateTo = (target: View) => {
    setView(target)
    router.replace(target === 'guide' ? '/settings?view=guide' : '/settings', { scroll: false })
  }

  if (view === 'guide') {
    return (
      <div key="guide" className="animate-in fade-in duration-150">
        <McpSetupGuide onBack={() => navigateTo('landing')} />
      </div>
    )
  }

  return (
    <div key="landing" className="animate-in fade-in duration-150 p-4 sm:p-6">
      <h1 className="text-xl sm:text-2xl font-semibold mb-2">Settings</h1>
      <p className="text-muted-foreground mb-8">
        Manage your preferences and application settings.
      </p>

      <div className="space-y-6">
        <section>
          <h2 className="text-lg font-semibold mb-4">Appearance</h2>
          <ThemeToggle />
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-4">Integrations</h2>
          <Card
            className="cursor-pointer hover:bg-accent/50 transition-colors py-0"
            onClick={() => navigateTo('guide')}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                navigateTo('guide')
              }
            }}
          >
            <CardContent className="py-4 flex items-center justify-between">
              <div>
                <div className="font-medium">Claude Desktop</div>
                <div className="text-sm text-muted-foreground">
                  Connect your knowledge bank to Claude Desktop
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            </CardContent>
          </Card>
        </section>

        <AdminSettingsLink />
      </div>
    </div>
  )
}
