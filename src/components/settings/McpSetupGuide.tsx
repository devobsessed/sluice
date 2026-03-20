'use client'

import { ArrowLeft, Check, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface McpSetupGuideProps {
  onBack: () => void
}

export function McpSetupGuide({ onBack }: McpSetupGuideProps) {
  return (
    <div>
      {/* Back button - outside centered container so it stays left-aligned */}
      <Button variant="ghost" size="sm" onClick={onBack} className="mb-6">
        <ArrowLeft className="mr-2 size-4" />
        Back to Settings
      </Button>

    <div className="max-w-3xl mx-auto">
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

      {/* Step 1 */}
      <StepSection number={1} title="Open Settings in Claude Desktop">
        <p>
          Click your profile icon in the bottom-left corner of Claude Desktop, then click{' '}
          <strong className="text-foreground">Settings</strong> (or press <Kbd>Cmd</Kbd> + <Kbd>,</Kbd>).
        </p>
        <ScreenshotImage
          src="/images/mcp-setup/step-1-open-settings.png"
          alt="Claude Desktop settings menu showing Settings option highlighted"
        />
      </StepSection>

      {/* Step 2 */}
      <StepSection number={2} title="Go to Developer and click Edit Config">
        <p>
          In the Settings sidebar, scroll down to{' '}
          <strong className="text-foreground">Developer</strong> under &quot;Desktop app.&quot; You&apos;ll
          see &quot;Local MCP servers&quot; with an{' '}
          <strong className="text-foreground">Edit Config</strong> button. Click it.
        </p>
        <ScreenshotImage
          src="/images/mcp-setup/step-2-select-developer-click-edit-config.png"
          alt="Settings page showing Developer tab selected and Edit Config button highlighted"
        />
      </StepSection>

      {/* Mid-step quote 2-3 */}
      <VinhQuote>
        Okay, checkpoint. You just found the Developer section. If you&apos;re thinking &apos;I didn&apos;t
        even know this existed&apos; - you&apos;re not alone. Most people don&apos;t. But this is where the
        magic happens.
      </VinhQuote>

      {/* Step 3 */}
      <StepSection number={3} title="Open the config file in TextEdit">
        <p>
          Finder opens showing{' '}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
            claude_desktop_config.json
          </code>
          . Right-click the file, choose <strong className="text-foreground">Open With</strong>, then
          select <strong className="text-foreground">TextEdit</strong>.
        </p>
        <ScreenshotImage
          src="/images/mcp-setup/step-3-open-claude-config-with-text-edit.png"
          alt="Finder showing right-click menu with Open With > TextEdit selected"
        />
        <InfoCallout title="Why TextEdit?">
          <p>
            It&apos;s the simplest editor on your Mac. If you prefer VS Code or another editor, that
            works too - just make sure you save as plain text, not rich text.
          </p>
        </InfoCallout>
      </StepSection>

      {/* Step 4 */}
      <StepSection number={4} title="Add the Sluice MCP configuration">
        <p>
          Add the{' '}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">mcpServers</code> block
          to your config file. If the file is empty or just has{' '}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{'{}'}</code>, replace
          it with:
        </p>
        <pre className="my-3 rounded-lg bg-slate-800 p-5 font-mono text-[13px] leading-7 text-slate-200 overflow-x-auto whitespace-pre-wrap break-all">
          <span className="text-slate-400">{'{'}</span>{'\n'}
          {'  '}<span className="text-emerald-300">&quot;mcpServers&quot;</span>
          <span className="text-slate-200">: </span>
          <span className="text-slate-400">{'{'}</span>{'\n'}
          {'    '}<span className="text-emerald-300">&quot;sluice&quot;</span>
          <span className="text-slate-200">: </span>
          <span className="text-slate-400">{'{'}</span>{'\n'}
          {'      '}<span className="text-emerald-300">&quot;command&quot;</span>
          <span className="text-slate-200">: </span>
          <span className="text-sky-300">&quot;npx&quot;</span>
          <span className="text-slate-200">,</span>{'\n'}
          {'      '}<span className="text-emerald-300">&quot;args&quot;</span>
          <span className="text-slate-200">: </span>
          <span className="text-slate-400">{'['}</span>{'\n'}
          {'        '}<span className="text-sky-300">&quot;-y&quot;</span>
          <span className="text-slate-200">,</span>{'\n'}
          {'        '}<span className="text-sky-300">&quot;mcp-remote&quot;</span>
          <span className="text-slate-200">,</span>{'\n'}
          {'        '}<span className="text-sky-300">&quot;https://sluice.vercel.app/api/mcp/mcp&quot;</span>{'\n'}
          {'      '}<span className="text-slate-400">{']'}</span>{'\n'}
          {'    '}<span className="text-slate-400">{'}'}</span>{'\n'}
          {'  '}<span className="text-slate-400">{'}'}</span>{'\n'}
          <span className="text-slate-400">{'}'}</span>
        </pre>
        <p>
          If you already have other content in the file, add the{' '}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">&quot;mcpServers&quot;</code>{' '}
          block inside the top-level{' '}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{'{}'}</code>, before
          any existing keys. Make sure your commas are correct.
        </p>
        <ScreenshotImage
          src="/images/mcp-setup/step-4-add-mcpServers-with-sluice-config.png"
          alt="TextEdit showing the claude_desktop_config.json with mcpServers block added"
        />
      </StepSection>

      {/* Mid-step quote 4-5 */}
      <VinhQuote>
        This is the step where most people hesitate. They see JSON and think &apos;I&apos;m going to break
        something.&apos; You won&apos;t. It&apos;s just a settings file. Copy, paste, save. Think of it like
        filling out a form - the structure is already there, you&apos;re just giving Claude the address of
        your Sluice knowledge bank.
      </VinhQuote>

      {/* Step 5 */}
      <StepSection number={5} title="Save the file">
        <p>
          Press <Kbd>Cmd</Kbd> + <Kbd>S</Kbd> to save, then close TextEdit.
        </p>
        <ScreenshotImage
          src="/images/mcp-setup/step-5-save-claude-desktop-config-with-mcp-config.png"
          alt="TextEdit File menu showing Save option"
        />
      </StepSection>

      {/* Step 6 */}
      <StepSection number={6} title="Restart Claude Desktop">
        <p>
          Quit Claude Desktop completely (<Kbd>Cmd</Kbd> + <Kbd>Q</Kbd>) and reopen it. Go back to{' '}
          <strong className="text-foreground">Settings &gt; Developer</strong>. You should see{' '}
          <strong className="text-foreground">sluice</strong> listed with a green{' '}
          <strong className="text-foreground">&quot;running&quot;</strong> badge.
        </p>
        <ScreenshotImage
          src="/images/mcp-setup/step-6-restart-server-open-settings-developer-sluice-connected.png"
          alt="Settings Developer page showing sluice MCP server with running status"
        />
        <SuccessBox>
          You&apos;re connected. Claude can now search your Sluice knowledge bank, chat with your
          creator personas, and pull insights directly into your conversations.
        </SuccessBox>
      </StepSection>

      {/* Final Vinh quote */}
      <VinhQuote>
        That&apos;s it. Six steps. You just gave Claude access to every video, every insight, every
        creator persona in your knowledge bank. Here&apos;s what just happened - you didn&apos;t just install
        a plugin. You built a bridge between your accumulated knowledge and your daily AI conversations.
        That&apos;s powerful. Go try it.
      </VinhQuote>

      {/* Tool grid */}
      <div className="my-9 rounded-xl border bg-muted/30 p-6">
        <h3 className="text-base font-semibold mb-4">What you can do now</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            {
              name: 'search_rag',
              desc: 'Search your knowledge bank with hybrid vector + keyword search',
            },
            {
              name: 'get_list_of_creators',
              desc: 'See all YouTube creators in your knowledge bank',
            },
            {
              name: 'chat_with_persona',
              desc: 'Ask a specific creator persona a question based on their content',
            },
            {
              name: 'ensemble_query',
              desc: 'Ask multiple personas at once and compare perspectives',
            },
          ].map((tool) => (
            <div key={tool.name} className="rounded-lg border bg-background p-3.5">
              <p className="font-mono text-sm font-semibold text-primary mb-1">{tool.name}</p>
              <p className="text-xs text-muted-foreground">{tool.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* OAuth callout */}
      <InfoCallout title="First time connecting?">
        <p>
          Claude will ask for your permission to use the Sluice tools the first time you trigger one.
          Click &quot;Allow&quot; to grant access. You&apos;ll sign in with your Sluice account via Google
          OAuth.
        </p>
      </InfoCallout>
    </div>
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

function StepSection({
  number,
  title,
  children,
}: {
  number: number
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="my-9">
      <div className="flex items-center gap-3 mb-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-base font-bold text-primary-foreground">
          {number}
        </div>
        <h3 className="text-lg font-semibold">{title}</h3>
      </div>
      <div className="ml-11 text-sm text-muted-foreground space-y-3">{children}</div>
    </div>
  )
}

function ScreenshotImage({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="my-3 rounded-lg border bg-muted/30 p-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} loading="lazy" className="w-full rounded-md" />
    </div>
  )
}

function SuccessBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-4 rounded-lg border border-emerald-200 bg-emerald-50/50 dark:border-emerald-800/50 dark:bg-emerald-950/20 p-5">
      <p className="text-sm text-emerald-800 dark:text-emerald-200">{children}</p>
    </div>
  )
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs shadow-sm">
      {children}
    </kbd>
  )
}
