'use client'

import { useEffect, useRef, useState } from 'react'
import { Send, ArrowLeft, Trash2, AlertCircle, RotateCcw } from 'lucide-react'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  usePersonaChat,
  isThreadBoundary,
  isChatMessage,
  type SourceChunk,
} from '@/hooks/usePersonaChat'
import { SourceCitation } from './SourceCitation'
import { PersonaActionsMenu } from './PersonaActionsMenu'
import { cn } from '@/lib/utils'

interface PersonaChatDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  personaId: number
  personaName: string
  expertiseTopics?: string[]
  /** When true, renders content directly without a Sheet wrapper (used inside ChatHubDrawer) */
  embedded?: boolean
  /** Called when back arrow is clicked in embedded mode */
  onBack?: () => void
}

interface PersonaAvatarProps {
  name: string
  className?: string
}

function PersonaAvatar({ name, className }: PersonaAvatarProps) {
  const initial = name.charAt(0).toUpperCase()
  return (
    <div
      aria-hidden="true"
      className={cn(
        'size-10 rounded-full bg-primary text-primary-foreground font-semibold flex items-center justify-center shrink-0',
        className
      )}
    >
      {initial}
    </div>
  )
}

function formatTimestamp(ts: number): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(ts))
}

/**
 * Splits answer text into segments: plain text and [n] citation markers.
 * Returns an array of { type: 'text' | 'citation', value: string, index: number }.
 */
interface TextSegment {
  type: 'text'
  value: string
}
interface CitationSegment {
  type: 'citation'
  n: number
}
type AnswerSegment = TextSegment | CitationSegment

function parseAnswerSegments(text: string): AnswerSegment[] {
  const CITATION_RE = /\[(\d+)\]/g
  const segments: AnswerSegment[] = []
  let lastIdx = 0
  let match: RegExpExecArray | null

  while ((match = CITATION_RE.exec(text)) !== null) {
    if (match.index > lastIdx) {
      segments.push({ type: 'text', value: text.slice(lastIdx, match.index) })
    }
    segments.push({ type: 'citation', n: parseInt(match[1]!, 10) })
    lastIdx = match.index + match[0].length
  }

  if (lastIdx < text.length) {
    segments.push({ type: 'text', value: text.slice(lastIdx) })
  }

  return segments
}

interface AnswerTextProps {
  text: string
  isStreaming?: boolean
  liveSources: SourceChunk[] | null
  onCitationClick: (n: number) => void
}

/**
 * Renders the answer text, parsing [n] markers into:
 * - Clickable affordances when liveSources is present (live turn)
 * - De-emphasized non-clickable text when liveSources is null (historical)
 * Out-of-range [n] markers are rendered as de-emphasized text (clamped away).
 */
function AnswerText({ text, isStreaming, liveSources, onCitationClick }: AnswerTextProps) {
  const paragraphs = text.split('\n\n')

  return (
    <div className="space-y-2">
      {paragraphs.map((paragraph, pIdx, arr) => {
        const segments = parseAnswerSegments(paragraph)
        const isLast = pIdx === arr.length - 1

        // Check if this paragraph actually has citation markers
        const hasParagraphCitations = segments.some((s) => s.type === 'citation')

        if (!hasParagraphCitations) {
          // No citations in this paragraph - render plain text directly in <p>
          // so existing tests asserting tagName === 'P' stay green
          return (
            <p key={pIdx}>
              {paragraph}
              {isStreaming && isLast && (
                <span className="motion-safe:animate-pulse">▌</span>
              )}
            </p>
          )
        }

        return (
          <p key={pIdx}>
            {segments.map((seg, sIdx) => {
              if (seg.type === 'text') {
                return <span key={sIdx}>{seg.value}</span>
              }

              // Citation segment
              const n = seg.n
              const sourceIndex = n - 1 // 0-based
              const isInRange = liveSources != null && sourceIndex >= 0 && sourceIndex < liveSources.length

              if (liveSources != null && isInRange) {
                // Live turn: clickable affordance
                return (
                  <button
                    key={sIdx}
                    type="button"
                    onClick={() => onCitationClick(sourceIndex)}
                    aria-label={`[${n}]`}
                    className="inline text-primary text-xs font-mono hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded-sm px-0.5"
                  >
                    [{n}]
                  </button>
                )
              }

              // Historical or out-of-range: de-emphasized non-clickable text
              return (
                <span
                  key={sIdx}
                  className="text-xs font-mono text-muted-foreground/50"
                >
                  [{n}]
                </span>
              )
            })}
            {isStreaming && isLast && (
              <span className="motion-safe:animate-pulse">▌</span>
            )}
          </p>
        )
      })}
    </div>
  )
}

/**
 * Returns true if the given answer text contains any [n] citation markers.
 */
function hasCitations(text: string): boolean {
  return /\[\d+\]/.test(text)
}

export function PersonaChatDrawer({
  open,
  onOpenChange,
  personaId,
  personaName,
  expertiseTopics,
  embedded = false,
  onBack,
}: PersonaChatDrawerProps) {
  const { state, liveSources, sendMessage, clearHistory, startNewThread } = usePersonaChat(personaId)
  const [inputValue, setInputValue] = useState('')
  const threadRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // Which source index to highlight in the SourceCitation list
  const [highlightIndex, setHighlightIndex] = useState<number | undefined>(undefined)
  // Track which message index is the "live" one (the last non-historical message)
  const lastMessageIdx = state.entries.length - 1

  const topicLabel =
    expertiseTopics && expertiseTopics.length > 0
      ? expertiseTopics.slice(0, 3).join(', ')
      : undefined

  // Auto-scroll to bottom when entries change
  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight
    }
  }, [state.entries])

  // Focus input when drawer opens
  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => {
      inputRef.current?.focus()
    }, 100)
    return () => clearTimeout(timer)
  }, [open])

  // Auto-scroll thread when virtual keyboard opens/closes on mobile
  useEffect(() => {
    if (!open) return

    function handleResize() {
      if (threadRef.current) {
        threadRef.current.scrollTop = threadRef.current.scrollHeight
      }
    }

    if (!window.visualViewport) return

    window.visualViewport.addEventListener('resize', handleResize)
    return () => {
      window.visualViewport?.removeEventListener('resize', handleResize)
    }
  }, [open])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = inputValue.trim()
    if (!trimmed || state.isStreaming) return
    setInputValue('')
    void sendMessage(trimmed)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      // Always prevent default for Enter to stop form submit from bubbling
      e.preventDefault()
      // Only send on plain Enter (not Shift+Enter)
      if (e.shiftKey) return
      const trimmed = inputValue.trim()
      if (!trimmed || state.isStreaming) return
      setInputValue('')
      void sendMessage(trimmed)
    }
  }

  function handleRetry(question: string) {
    void sendMessage(question)
  }

  function handleCitationClick(sourceIndex: number) {
    setHighlightIndex(sourceIndex)
  }

  const hasMessages = state.messages.length > 0

  // Find the last error message question for the error banner retry
  const lastErrorMessage = state.error
    ? state.messages.findLast((m) => m.isError === true)
    : null

  // Index of the last thread boundary in entries (for dimming pre-boundary messages)
  const lastBoundaryIdx = state.entries.reduce<number>(
    (acc, entry, idx) => (isThreadBoundary(entry) ? idx : acc),
    -1
  )

  // Inner content — shared between embedded and Sheet modes
  const content = (
    <>
      {/* Header */}
      <SheetHeader className="flex-row items-center gap-3 px-4 py-3 border-b shrink-0">
        {/* Back arrow: always visible in embedded mode, mobile-only otherwise */}
        <Button
          variant="ghost"
          size="icon-xs"
          className={cn('-ml-1', !embedded && 'md:hidden')}
          onClick={embedded ? onBack : () => onOpenChange(false)}
          aria-label={embedded ? 'Back to hub' : 'Close chat'}
        >
          <ArrowLeft />
        </Button>

        <PersonaAvatar name={personaName} />

        <div className="flex flex-col min-w-0 flex-1">
          <SheetTitle className="text-base leading-tight">{personaName}</SheetTitle>
          {topicLabel && (
            <SheetDescription className="truncate text-xs leading-tight mt-0.5">
              {topicLabel}
            </SheetDescription>
          )}
        </div>

        {/* New thread button — only when messages exist */}
        {hasMessages && (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={startNewThread}
            aria-label="New thread"
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            <RotateCcw />
          </Button>
        )}

        {/* Clear history button — only when messages exist */}
        {hasMessages && (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={clearHistory}
            aria-label="Clear history"
            className="shrink-0 text-muted-foreground hover:text-destructive"
          >
            <Trash2 />
          </Button>
        )}

        {/* Persona-level actions menu (always visible, extensible) */}
        <PersonaActionsMenu
          personaId={personaId}
          personaName={personaName}
        />
      </SheetHeader>

      {/* Message Thread */}
      <div
        ref={threadRef}
        className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4"
      >
        {/* Empty state */}
        {!hasMessages && (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
            Ask {personaName} anything...
          </div>
        )}

        {/* Entries: messages and thread boundaries */}
        {state.entries.map((entry, idx) => {
          if (isThreadBoundary(entry)) {
            // Thread boundary divider
            const label = idx === 0 ? 'Earlier messages (no memory)' : 'New thread'
            return (
              <div
                key={`boundary-${idx}`}
                className="flex items-center gap-2 my-1"
                role="separator"
                aria-label={label}
              >
                <div className="flex-1 border-t border-dashed border-muted-foreground/30" />
                <span className="text-[11px] text-muted-foreground/60 shrink-0">{label}</span>
                <div className="flex-1 border-t border-dashed border-muted-foreground/30" />
              </div>
            )
          }

          if (!isChatMessage(entry)) return null

          const msg = entry
          const isDimmed = lastBoundaryIdx !== -1 && idx < lastBoundaryIdx
          // The last message entry is the "live" one when liveSources is present
          const isLiveMessage = idx === lastMessageIdx && liveSources != null

          // Determine if this message has [n] markers we can show sources for
          const messageHasCitations = hasCitations(msg.answer)
          const showSourceCitation = isLiveMessage && messageHasCitations

          return (
            <div
              key={idx}
              className={cn(
                'flex flex-col gap-2 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-150',
                isDimmed && 'opacity-50'
              )}
            >
              {/* Timestamp */}
              <p className="text-[11px] text-muted-foreground text-center">
                {formatTimestamp(msg.timestamp)}
              </p>

              {/* User question bubble */}
              <div className="flex justify-end">
                <div className="max-w-[80%] px-4 py-2 rounded-2xl rounded-br-md bg-primary text-primary-foreground text-sm">
                  {msg.question}
                </div>
              </div>

              {/* Persona answer bubble */}
              <div className="flex items-end gap-2">
                <PersonaAvatar name={personaName} className="size-6 text-xs" />
                <div className="max-w-[80%] flex-1 px-4 py-2 rounded-2xl rounded-bl-md bg-muted text-sm">
                  {msg.isError ? (
                    <span className="flex items-center gap-1.5 text-destructive">
                      <AlertCircle className="size-4 shrink-0" />
                      Something went wrong, try again
                    </span>
                  ) : msg.isStreaming && !msg.answer ? (
                    // Loading skeleton — streaming but no text yet
                    <div className="flex flex-col gap-1.5 py-0.5">
                      <div
                        data-testid="streaming-skeleton"
                        className="h-3 w-32 rounded bg-muted-foreground/20 animate-pulse"
                      />
                      <div
                        data-testid="streaming-skeleton"
                        className="h-3 w-24 rounded bg-muted-foreground/20 animate-pulse"
                      />
                    </div>
                  ) : (
                    <AnswerText
                      text={msg.answer}
                      isStreaming={msg.isStreaming}
                      liveSources={isLiveMessage ? liveSources : null}
                      onCitationClick={handleCitationClick}
                    />
                  )}
                </div>
              </div>

              {/* SourceCitation list — only for the live turn that has citations */}
              {showSourceCitation && (
                <div className="ml-8">
                  <SourceCitation
                    sources={liveSources}
                    highlightIndex={highlightIndex}
                    forceOpen={false}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Error banner */}
      {state.error && lastErrorMessage && (
        <div className="px-4 py-2 bg-destructive/10 border-t border-destructive/20 flex items-center justify-between gap-2 shrink-0">
          <p className="text-sm text-destructive">{state.error}</p>
          <Button
            variant="outline"
            size="xs"
            onClick={() => handleRetry(lastErrorMessage.question)}
            aria-label="Retry"
          >
            Retry
          </Button>
        </div>
      )}

      {/* Memory indicator */}
      <p className="text-[11px] text-muted-foreground text-center py-1 px-4 shrink-0">
        Remembers last 50 exchanges
      </p>

      {/* Input bar */}
      <form
        onSubmit={handleSubmit}
        className={cn(
          'flex items-center gap-2 px-4 pt-2 shrink-0 border-t',
          'pb-[max(0.75rem,env(safe-area-inset-bottom))]'
        )}
      >
        <Input
          ref={inputRef}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={`Ask ${personaName} anything...`}
          disabled={state.isStreaming}
          className="rounded-full text-base"
          aria-label={`Ask ${personaName} a question`}
        />
        <Button
          type="submit"
          size="icon"
          disabled={!inputValue.trim() || state.isStreaming}
          aria-label="Send message"
        >
          <Send />
        </Button>
      </form>
    </>
  )

  // In embedded mode, render content in a plain div (no Sheet wrapper)
  if (embedded) {
    return (
      <div className="flex flex-col h-full">
        {content}
      </div>
    )
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className={cn(
          'flex flex-col p-0 gap-0',
          'md:w-[400px] md:max-w-[400px]',
          'max-md:w-screen max-md:max-w-none max-md:border-l-0'
        )}
      >
        {content}
      </SheetContent>
    </Sheet>
  )
}
