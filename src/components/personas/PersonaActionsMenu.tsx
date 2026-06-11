'use client'

import { useState } from 'react'
import { MoreHorizontal, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

type RegenerateStatus = 'idle' | 'loading' | 'success' | 'error'

interface PersonaActionsMenuProps {
  personaId: number
  personaName: string
  /** Called after a successful regeneration */
  onRegenSuccess?: () => void
  className?: string
}

/**
 * Dropdown menu for persona-level actions. Extensible: story 4 adds 'What I remember' here.
 *
 * Currently exposes:
 * - Regenerate persona (calls POST /api/personas/[id]/regenerate)
 */
export function PersonaActionsMenu({
  personaId,
  personaName,
  onRegenSuccess,
  className,
}: PersonaActionsMenuProps) {
  const [status, setStatus] = useState<RegenerateStatus>('idle')
  const [isOpen, setIsOpen] = useState(false)

  async function handleRegenerate() {
    if (status === 'loading') return

    setStatus('loading')
    // Close the menu so the loading indicator is visible in context
    setIsOpen(false)

    try {
      const response = await fetch(`/api/personas/${personaId}/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })

      if (!response.ok) {
        setStatus('error')
        // Clear error state after a delay so the user can re-try
        setTimeout(() => setStatus('idle'), 4000)
        return
      }

      setStatus('success')
      onRegenSuccess?.()

      // Reset to idle after success indicator
      setTimeout(() => setStatus('idle'), 2500)
    } catch {
      setStatus('error')
      setTimeout(() => setStatus('idle'), 4000)
    }
  }

  return (
    <div className={cn('flex items-center gap-1', className)}>
      {/* Feedback badge - visible when action is in flight or has a result */}
      {status === 'loading' && (
        <span
          aria-live="polite"
          className="text-xs text-muted-foreground flex items-center gap-1"
        >
          <RefreshCw className="size-3 animate-spin" aria-hidden="true" />
          Regenerating...
        </span>
      )}
      {status === 'success' && (
        <span
          aria-live="polite"
          className="text-xs text-primary"
        >
          Persona updated
        </span>
      )}
      {status === 'error' && (
        <span
          aria-live="polite"
          className="text-xs text-destructive"
        >
          Regeneration failed
        </span>
      )}

      <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Persona actions for ${personaName}`}
            className="shrink-0 text-muted-foreground hover:text-foreground"
            disabled={status === 'loading'}
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={handleRegenerate}
            disabled={status === 'loading'}
          >
            <RefreshCw className="size-4" />
            Regenerate persona
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
