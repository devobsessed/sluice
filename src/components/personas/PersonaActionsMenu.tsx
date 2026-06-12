'use client'

import { useState } from 'react'
import { MoreHorizontal, RefreshCw, BookOpen, X, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
  /** Remembered facts for this persona. When provided, "What I remember" item is shown. */
  facts?: string[]
  /** Called to remove a single fact by exact string match. */
  onRemoveFact?: (fact: string) => void
  /** Called to clear all facts for this persona. */
  onClearFacts?: () => void
}

/**
 * Dropdown menu for persona-level actions.
 *
 * Exposes:
 * - Regenerate persona (calls POST /api/personas/[id]/regenerate)
 * - What I remember (inline facts viewer with per-fact remove and clear-all)
 */
export function PersonaActionsMenu({
  personaId,
  personaName,
  onRegenSuccess,
  className,
  facts = [],
  onRemoveFact,
  onClearFacts,
}: PersonaActionsMenuProps) {
  const [status, setStatus] = useState<RegenerateStatus>('idle')
  const [isOpen, setIsOpen] = useState(false)
  const [showFacts, setShowFacts] = useState(false)

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

  function handleOpenFactsViewer() {
    setShowFacts(true)
  }

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="flex items-center gap-1">
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
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={handleOpenFactsViewer}>
              <BookOpen className="size-4" />
              What I remember
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Inline facts viewer — shown after "What I remember" is selected */}
      {showFacts && (
        <div
          className="w-full bg-secondary border border-border rounded-md p-3 flex flex-col gap-2 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-150"
          aria-label="What I remember"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-foreground">What I remember</span>
            <div className="flex items-center gap-1">
              {facts.length > 0 && (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => onClearFacts?.()}
                  className="h-5 px-1.5 text-xs text-muted-foreground hover:text-destructive"
                  aria-label="Clear all"
                >
                  Clear all
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => setShowFacts(false)}
                className="size-5 text-muted-foreground hover:text-foreground"
                aria-label="Close facts viewer"
              >
                <X className="size-3" />
              </Button>
            </div>
          </div>

          {facts.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Nothing yet - I&apos;ll remember key facts when you start a new thread.
            </p>
          ) : (
            <ul className="flex flex-col gap-1 list-none">
              {facts.map((fact, idx) => (
                <li
                  key={idx}
                  className="group flex items-center justify-between gap-2 px-2 py-1 rounded-md bg-secondary"
                >
                  <span className="flex items-center gap-1.5 text-xs text-foreground min-w-0">
                    <span
                      className="size-1.5 rounded-full bg-primary shrink-0"
                      aria-hidden="true"
                    />
                    <span className="truncate">{fact}</span>
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => onRemoveFact?.(fact)}
                    className="size-5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                    aria-label={`Remove fact`}
                    tabIndex={0}
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
