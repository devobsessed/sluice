'use client'

import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface McpSetupGuideProps {
  onBack: () => void
}

export function McpSetupGuide({ onBack }: McpSetupGuideProps) {
  return (
    <div className="p-4 sm:p-6">
      <Button variant="ghost" onClick={onBack} className="mb-4 -ml-2">
        <ArrowLeft className="h-4 w-4 mr-2" />
        Back
      </Button>
      <p className="text-muted-foreground">Guide content placeholder</p>
    </div>
  )
}
