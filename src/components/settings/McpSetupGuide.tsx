'use client'

import { ArrowLeft, Check, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface McpSetupGuideProps {
  onBack: () => void
}

export function McpSetupGuide({ onBack }: McpSetupGuideProps) {
  return (
    <div className="max-w-3xl">
      {/* Back button */}
      <Button variant="ghost" size="sm" onClick={onBack} className="mb-6 -ml-2">
        <ArrowLeft className="mr-2 size-4" />
        Back to Settings
      </Button>

      {/* Header */}
      <div className="text-center mb-10 pb-8 border-b">
        <h2 className="text-2xl sm:text-3xl font-bold mb-2">
          Connect Sluice to Claude Desktop
        </h2>
        <p className="text-muted-foreground mb-6">
          Give Claude access to your knowledge bank in 5 minutes
        </p>
        <div className="inline-flex items-center gap-2 rounded-full border bg-muted/50 px-4 py-1.5 text-sm text-muted-foreground">
          <span className="size-2 rounded-full bg-primary" />
          Guided by <strong className="text-foreground">Vinh Giang</strong> from your knowledge bank
        </div>
      </div>

      {/* Opening Vinh Giang quote */}
      <VinhQuote>
        Alright, here&apos;s the thing - connecting Sluice to Claude Desktop is like tuning a guitar before you play. It takes about 2 minutes, but everything after sounds so much better. I&apos;m going to walk you through 6 steps. Each one is simple on its own. By the end, Claude will be able to search your entire knowledge bank, talk to your creator personas, and pull insights from every video you&apos;ve ever added. Let&apos;s go.
      </VinhQuote>

      {/* Prerequisites */}
      <div className="my-6 rounded-lg border bg-muted/30 p-5">
        <h3 className="text-sm font-semibold mb-3">Before you start</h3>
        <ul className="space-y-2">
          {[
            'Claude Desktop installed on your Mac',
            'A Sluice account at sluice.vercel.app',
            "Node.js installed (see below if you're not sure)",
          ].map((item) => (
            <li key={item} className="flex items-start gap-2 text-sm text-muted-foreground">
              <Check className="size-4 shrink-0 text-primary mt-0.5" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Node.js callout */}
      <InfoCallout title="Don't have Node.js?">
        <p>
          Open <strong className="text-foreground">Terminal</strong> (search &quot;Terminal&quot; in Spotlight) and paste this command:
        </p>
        <CodeBlock>brew install node</CodeBlock>
        <p>If you don&apos;t have Homebrew either, paste this first:</p>
        <CodeBlock>/bin/bash -c &quot;$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)&quot;</CodeBlock>
        <p className="text-xs mt-2">
          After installing, close and reopen Terminal, then run{' '}
          <code className="rounded bg-blue-100 px-1.5 py-0.5 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">
            brew install node
          </code>
          . That gives you both Node.js and npx.
        </p>
      </InfoCallout>

      {/* Steps will go here (chunk 3) */}

      {/* Tool grid and footer callout will go here (chunk 3) */}
    </div>
  )
}

/* ---- Sub-components ---- */

function VinhQuote({ children }: { children: React.ReactNode }) {
  return (
    <blockquote className="my-6 rounded-r-lg border-l-[3px] border-primary bg-emerald-50/50 dark:bg-emerald-950/20 py-4 px-5">
      <p className="text-sm italic text-muted-foreground leading-relaxed">
        &quot;{children}&quot;
      </p>
      <p className="mt-2 text-xs text-muted-foreground/70">- Vinh Giang</p>
    </blockquote>
  )
}

function InfoCallout({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="my-6 rounded-lg border border-blue-200 bg-blue-50/50 dark:border-blue-800/50 dark:bg-blue-950/20 p-5">
      <div className="flex items-center gap-2 mb-2">
        <Info className="size-4 text-blue-600 dark:text-blue-400" />
        <span className="text-xs font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-400">
          {title}
        </span>
      </div>
      <div className="text-sm text-blue-900 dark:text-blue-200 space-y-2">
        {children}
      </div>
    </div>
  )
}

function CodeBlock({ children }: { children: React.ReactNode }) {
  return (
    <pre className="my-2 rounded-lg bg-slate-800 p-4 font-mono text-sm text-slate-200 overflow-x-auto whitespace-pre-wrap break-all">
      {children}
    </pre>
  )
}
