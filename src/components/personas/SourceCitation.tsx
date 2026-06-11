'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@/components/ui/collapsible'
import { Button } from '@/components/ui/button'
import { ChevronDown, ChevronUp, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Source {
  chunkId: number
  content: string
  videoTitle: string
  /** Video timestamp in seconds — used to build YouTube deep-link */
  startTime?: number | null
  /** YouTube video ID — required for timestamp link rendering */
  youtubeId?: string | null
}

interface SourceCitationProps {
  sources: Source[]
  /**
   * When set, opens the collapsible and scrolls to + briefly highlights the
   * entry at this 0-based index. Changes to this value retrigger the scroll.
   */
  highlightIndex?: number
  /** When true the collapsible starts open on first render */
  forceOpen?: boolean
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function SourceCitation({
  sources,
  highlightIndex,
  forceOpen = false,
}: SourceCitationProps) {
  // User-controlled open state; starts open when forceOpen or a highlightIndex is provided
  const [isOpen, setIsOpen] = useState(() => forceOpen || highlightIndex != null)
  // Track the last seen highlightIndex so we can detect new values
  const [lastHighlightSeen, setLastHighlightSeen] = useState<number | undefined>(highlightIndex)
  // The entry index currently showing a highlight ring (transient)
  const [activeHighlight, setActiveHighlight] = useState<number | null>(null)
  const entryRefs = useRef<Array<HTMLDivElement | null>>([])

  // Detect a new highlightIndex using the "store previous props in state" pattern.
  // Calling setState during render (when props change) is the correct React way to
  // derive state from props without effects. The extra render is intentional and cheap.
  // See: https://react.dev/reference/react/useState#storing-information-from-previous-renders
  if (highlightIndex !== lastHighlightSeen) {
    setLastHighlightSeen(highlightIndex)
    if (highlightIndex != null) {
      setIsOpen(true)
      setActiveHighlight(highlightIndex)
    }
  }

  // Scroll-only effect: pure DOM side-effect, no setState needed.
  // Runs after the component re-renders with the updated open state so the
  // entry is in the DOM before we try to scroll to it.
  useEffect(() => {
    if (lastHighlightSeen == null) return

    const scrollTimer = setTimeout(() => {
      entryRefs.current[lastHighlightSeen]?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      })
    }, 150)

    // Clear the transient highlight ring after a short display window
    const ringTimer = setTimeout(() => {
      setActiveHighlight(null)
    }, 1800)

    return () => {
      clearTimeout(scrollTimer)
      clearTimeout(ringTimer)
    }
  }, [lastHighlightSeen])

  const sourceText = sources.length === 1 ? '1 source' : `${sources.length} sources`

  if (sources.length === 0) {
    return null
  }

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-between text-xs text-muted-foreground"
          aria-label={`${sourceText} - click to ${isOpen ? 'collapse' : 'expand'}`}
        >
          <span>{sourceText}</span>
          {isOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </Button>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="mt-2 space-y-2">
          {sources.map((source, idx) => {
            const isHighlighted = activeHighlight === idx
            const hasTimestampLink =
              source.youtubeId != null && source.startTime != null

            return (
              <div
                key={source.chunkId}
                ref={(el) => { entryRefs.current[idx] = el }}
                data-testid={`source-entry-${idx}`}
                className={cn(
                  'rounded border bg-muted/50 p-2 text-xs transition-all duration-300',
                  isHighlighted && 'ring-2 ring-primary/60 bg-primary/5'
                )}
              >
                <div className="flex items-start justify-between gap-1 mb-1">
                  <span className="font-mono text-muted-foreground/70 shrink-0">
                    [{idx + 1}]
                  </span>
                  {hasTimestampLink && (
                    <a
                      href={`https://www.youtube.com/watch?v=${source.youtubeId}&t=${source.startTime}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline flex items-center gap-0.5 shrink-0"
                      aria-label={`${source.videoTitle} at ${formatTime(source.startTime!)}`}
                    >
                      <ExternalLink className="size-3" aria-hidden="true" />
                      <span>{formatTime(source.startTime!)}</span>
                    </a>
                  )}
                </div>
                <p className="line-clamp-3 text-foreground">{source.content}</p>
                <p className="mt-1 text-muted-foreground">{source.videoTitle}</p>
              </div>
            )
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
