'use client';

import { Sparkles, FileText, Lightbulb, CheckSquare, AlertCircle, X, WifiOff, Loader2, Brain } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { InsightSection } from './InsightSection';
import { ClaudeCodeSection } from './ClaudeCodeSection';
import type { ExtractionResult } from '@/lib/claude/prompts/types';
import type { SectionStatus } from '@/hooks/useExtraction';
import type { ConnectionStatus } from '@/lib/agent/connection';

interface InsightsPanelProps {
  status: 'idle' | 'streaming' | 'done' | 'error';
  extractionData: Partial<ExtractionResult>;
  sectionStatuses?: {
    summary: SectionStatus;
    insights: SectionStatus;
    actions: SectionStatus;
    claudeCode: SectionStatus;
    knowledgePrompt: SectionStatus;
  };
  error?: string;
  onExtract: () => void;
  onCancel?: () => void;
  agentStatus?: ConnectionStatus;
  agentError?: string;
  videoCreatedAt?: Date;
  className?: string;
}

// Extracted outside component to avoid impure-function-during-render lint errors
function getEmptyStateVariant(videoCreatedAt?: Date): 'generating' | 'timeout' | 'local' {
  const isProduction = !!process.env.NEXT_PUBLIC_VERCEL
  if (!isProduction) return 'local'
  if (!videoCreatedAt) return 'local'
  const ageMs = Date.now() - new Date(videoCreatedAt).getTime()
  const TEN_MINUTES_MS = 10 * 60 * 1000
  return ageMs < TEN_MINUTES_MS ? 'generating' : 'timeout'
}

function formatAddedAgo(createdAt: Date): string {
  const diffMs = Date.now() - new Date(createdAt).getTime()
  const minutes = Math.max(0, Math.floor(diffMs / 60000))
  if (minutes === 0) return 'Added just now'
  if (minutes === 1) return 'Added 1 minute ago'
  return `Added ${minutes} minutes ago`
}

/**
 * Main insights panel with empty state, streaming state, and complete state.
 * Shows sections for summary, insights, action items, and Claude Code plugins.
 */
export function InsightsPanel({
  status,
  extractionData,
  sectionStatuses,
  error,
  onExtract,
  onCancel,
  agentStatus,
  agentError,
  videoCreatedAt,
  className,
}: InsightsPanelProps) {
  // Agent connection status - show when not connected
  if (agentStatus === 'connecting') {
    return (
      <div className={className}>
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Loader2 className="mb-4 h-12 w-12 animate-spin will-change-transform text-muted-foreground" />
          <h3 className="mb-2 text-lg font-medium">Connecting to Claude Code agent</h3>
          <p className="max-w-md text-muted-foreground">
            Establishing connection to the local agent...
          </p>
        </div>
      </div>
    );
  }

  if (agentStatus === 'error' || (agentStatus === 'disconnected' && agentError)) {
    return (
      <div className={className}>
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <WifiOff className="mb-4 h-12 w-12 text-destructive" />
          <h3 className="mb-2 text-lg font-medium text-destructive">
            Agent not available
          </h3>
          <p className="mb-6 max-w-md text-muted-foreground">
            {agentError || 'Could not connect to the Claude Code agent. Make sure the agent is running.'}
          </p>
        </div>
      </div>
    );
  }

  // Empty state
  const hasNoData = !extractionData || Object.keys(extractionData).length === 0;
  if (status === 'idle' && hasNoData) {
    const variant = getEmptyStateVariant(videoCreatedAt)

    if (variant === 'generating') {
      return (
        <div className={cn('transition-opacity duration-300', className)}>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Sparkles className="mb-4 h-12 w-12 text-muted-foreground animate-breathe" />
            <h3 className="mb-2 text-lg font-medium">Insights are on their way</h3>
            <p className="mb-4 max-w-md text-muted-foreground">
              Claude is analyzing this video. They&apos;ll appear here automatically.
            </p>
            {videoCreatedAt && (
              <p className="text-sm text-muted-foreground">
                {formatAddedAgo(videoCreatedAt)}
              </p>
            )}
          </div>
        </div>
      )
    }

    if (variant === 'timeout') {
      return (
        <div className={cn('transition-opacity duration-300', className)}>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <AlertCircle className="mb-4 h-12 w-12 text-muted-foreground" />
            <h3 className="mb-2 text-lg font-medium">Insights didn&apos;t arrive as expected</h3>
            <p className="mb-6 max-w-md text-muted-foreground">
              The automatic generation may have encountered an issue.
            </p>
            <Button onClick={onExtract} size="lg">
              <Sparkles className="mr-2 h-4 w-4" />
              Generate Insights
            </Button>
          </div>
        </div>
      )
    }

    // local variant - preserve original empty state verbatim
    return (
      <div className={className}>
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Sparkles className="mb-4 h-12 w-12 text-muted-foreground" />
          <h3 className="mb-2 text-lg font-medium">No insights generated yet</h3>
          <p className="mb-6 max-w-md text-muted-foreground">
            Claude will analyze this video and extract summaries, key insights,
            action items, and Claude Code plugins (if dev content).
          </p>
          <Button onClick={onExtract} size="lg">
            <Sparkles className="mr-2 h-4 w-4" />
            Extract Insights
          </Button>
        </div>
      </div>
    );
  }

  // Error state
  if (status === 'error') {
    return (
      <div className={className}>
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <AlertCircle className="mb-4 h-12 w-12 text-destructive" />
          <h3 className="mb-2 text-lg font-medium text-destructive">
            Failed to extract insights
          </h3>
          <p className="mb-6 max-w-md text-muted-foreground">
            {error || 'Something went wrong while analyzing the video. Please try again.'}
          </p>
          <Button onClick={onExtract} variant="outline">
            Try Again
          </Button>
        </div>
      </div>
    );
  }

  // Use provided section statuses or fallback to simple logic
  const getSectionStatus = (section: 'summary' | 'insights' | 'actions' | 'claudeCode' | 'knowledgePrompt') => {
    if (sectionStatuses) {
      return sectionStatuses[section];
    }
    // Fallback for when sectionStatuses not provided
    if (status === 'done') return 'done';
    if (status === 'streaming') return 'working';
    return 'pending';
  };

  // Format content for each section
  const getSummaryContent = () => {
    if (!extractionData?.summary) return '';
    const { summary } = extractionData;
    return `${summary.tldr}\n\n${summary.overview}\n\nKey Points:\n${summary.keyPoints.map((p) => `• ${p}`).join('\n')}`;
  };

  const getInsightsContent = () => {
    if (!extractionData?.insights || extractionData.insights.length === 0) return '';
    return extractionData.insights
      .map((i) => `[${i.timestamp}] ${i.title}\n${i.explanation}\n\nActionable: ${i.actionable}`)
      .join('\n\n---\n\n');
  };

  const getActionsContent = () => {
    if (!extractionData?.actionItems) return '';
    const { actionItems } = extractionData;
    let content = '';
    if (actionItems.immediate && actionItems.immediate.length > 0) {
      content += `Immediate:\n${actionItems.immediate.map((a) => `• ${a}`).join('\n')}\n\n`;
    }
    if (actionItems.shortTerm && actionItems.shortTerm.length > 0) {
      content += `Short-term:\n${actionItems.shortTerm.map((a) => `• ${a}`).join('\n')}\n\n`;
    }
    if (actionItems.longTerm && actionItems.longTerm.length > 0) {
      content += `Long-term:\n${actionItems.longTerm.map((a) => `• ${a}`).join('\n')}\n\n`;
    }
    if (actionItems.resources && actionItems.resources.length > 0) {
      content += `Resources:\n${actionItems.resources.map((r) => `• ${r.name}: ${r.description}`).join('\n')}`;
    }
    return content;
  };

  // Calculate progress for streaming state
  const getProgress = () => {
    if (!sectionStatuses) return { done: 0, total: 5 };
    const statuses = Object.values(sectionStatuses);
    const done = statuses.filter(s => s === 'done').length;
    return { done, total: statuses.length };
  };

  const progress = getProgress();

  return (
    <div className={className}>
      <div className="space-y-6">
        {/* Progress header when streaming */}
        {status === 'streaming' && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/30 p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin will-change-transform text-blue-600" />
                <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
                  Extracting insights...
                </span>
              </div>
              <span className="text-xs text-blue-600 dark:text-blue-400">
                {progress.done} of {progress.total} sections complete
              </span>
            </div>
            <div className="h-2 bg-blue-200 dark:bg-blue-900 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-600 transition-[width] duration-500 ease-out rounded-full"
                style={{ width: `${(progress.done / progress.total) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* Summary Section */}
        <InsightSection
          title="Summary"
          icon={FileText}
          status={getSectionStatus('summary')}
          content={getSummaryContent()}
        />

        {/* Key Insights Section */}
        <InsightSection
          title="Key Insights"
          icon={Lightbulb}
          status={getSectionStatus('insights')}
          content={getInsightsContent()}
        />

        {/* Action Items Section */}
        <InsightSection
          title="Action Items"
          icon={CheckSquare}
          status={getSectionStatus('actions')}
          content={getActionsContent()}
        />

        {/* Knowledge Prompt Section - show during streaming or if present */}
        {(status === 'streaming' || extractionData?.knowledgePrompt) && (
          <InsightSection
            title="Knowledge Prompt"
            icon={Brain}
            status={getSectionStatus('knowledgePrompt')}
            content={extractionData?.knowledgePrompt || ''}
          />
        )}

        {/* Claude Code Section - only if applicable */}
        {extractionData?.claudeCode?.applicable && (
          <ClaudeCodeSection
            skills={extractionData.claudeCode.skills}
            commands={extractionData.claudeCode.commands}
            agents={extractionData.claudeCode.agents}
            hooks={extractionData.claudeCode.hooks}
            rules={extractionData.claudeCode.rules}
          />
        )}

        {/* Cancel button when streaming */}
        {status === 'streaming' && onCancel && (
          <div className="flex justify-center pt-4">
            <Button onClick={onCancel} variant="outline">
              <X className="mr-2 h-4 w-4" />
              Cancel
            </Button>
          </div>
        )}

        {/* Regenerate button when done */}
        {status === 'done' && (
          <div className="flex justify-center pt-4">
            <Button onClick={onExtract} variant="outline">
              <Sparkles className="mr-2 h-4 w-4" />
              Regenerate
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
