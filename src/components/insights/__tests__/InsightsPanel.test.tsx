import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { InsightsPanel } from '../InsightsPanel';
import type { ExtractionResult } from '@/lib/claude/prompts/types';

const mockExtractionResult: ExtractionResult = {
  contentType: 'dev',
  summary: {
    tldr: 'Test TLDR',
    overview: 'Test overview',
    keyPoints: ['Point 1', 'Point 2'],
  },
  insights: [
    {
      title: 'Insight 1',
      timestamp: '0:00',
      explanation: 'Explanation',
      actionable: 'Action',
    },
  ],
  actionItems: {
    immediate: ['Do this now'],
    shortTerm: ['Do this soon'],
    longTerm: ['Do this later'],
    resources: [{ name: 'Resource', description: 'Description' }],
  },
  knowledgePrompt: 'This video teaches specific techniques for optimizing database queries. Key techniques include: using EXPLAIN ANALYZE to identify slow queries, adding appropriate indexes on foreign key columns, and using connection pooling with a max of 20 connections. The presenter demonstrates these with concrete examples from a production Rails app.',
  claudeCode: {
    applicable: false,
    skills: [],
    commands: [],
    agents: [],
    hooks: [],
    rules: [],
  },
};

describe('InsightsPanel', () => {
  describe('Empty State', () => {
    it('renders empty state by default', () => {
      const onExtract = vi.fn();
      render(
        <InsightsPanel
          status="idle"
          extractionData={{}}
          onExtract={onExtract}
        />
      );

      expect(screen.getByText('No insights generated yet')).toBeInTheDocument();
    });

    it('shows extract insights button in empty state', () => {
      const onExtract = vi.fn();
      render(
        <InsightsPanel
          status="idle"
          extractionData={{}}
          onExtract={onExtract}
        />
      );

      expect(screen.getByRole('button', { name: /extract insights/i })).toBeInTheDocument();
    });

    it('calls onExtract when extract button clicked', async () => {
      const user = userEvent.setup();
      const onExtract = vi.fn();
      render(
        <InsightsPanel
          status="idle"
          extractionData={{}}
          onExtract={onExtract}
        />
      );

      const button = screen.getByRole('button', { name: /extract insights/i });
      await user.click(button);

      expect(onExtract).toHaveBeenCalledTimes(1);
    });

    it('shows helpful description in empty state', () => {
      const onExtract = vi.fn();
      render(
        <InsightsPanel
          status="idle"
          extractionData={{}}
          onExtract={onExtract}
        />
      );

      expect(screen.getByText(/analyze this video/i)).toBeInTheDocument();
    });
  });

  describe('Streaming State', () => {
    it('shows sections when status is streaming', () => {
      const onExtract = vi.fn();
      render(
        <InsightsPanel
          status="streaming"
          extractionData={{}}
          onExtract={onExtract}
        />
      );

      expect(screen.getByText('Summary')).toBeInTheDocument();
      expect(screen.getByText('Key Insights')).toBeInTheDocument();
      expect(screen.getByText('Action Items')).toBeInTheDocument();
    });

    it('disables extract button during streaming', () => {
      const onExtract = vi.fn();
      render(
        <InsightsPanel
          status="streaming"
          extractionData={{}}
          onExtract={onExtract}
        />
      );

      // Should not show extract button when streaming
      expect(screen.queryByRole('button', { name: /extract insights/i })).not.toBeInTheDocument();
    });
  });

  describe('Complete State', () => {
    it('shows sections with complete data', () => {
      const onExtract = vi.fn();
      render(
        <InsightsPanel
          status="done"
          extractionData={mockExtractionResult}
          onExtract={onExtract}
        />
      );

      expect(screen.getByText('Summary')).toBeInTheDocument();
      expect(screen.getByText('Key Insights')).toBeInTheDocument();
      expect(screen.getByText('Action Items')).toBeInTheDocument();
    });

    it('shows regenerate button when done', () => {
      const onExtract = vi.fn();
      render(
        <InsightsPanel
          status="done"
          extractionData={mockExtractionResult}
          onExtract={onExtract}
        />
      );

      expect(screen.getByRole('button', { name: /regenerate/i })).toBeInTheDocument();
    });

    it('calls onExtract when regenerate button clicked', async () => {
      const user = userEvent.setup();
      const onExtract = vi.fn();
      render(
        <InsightsPanel
          status="done"
          extractionData={mockExtractionResult}
          onExtract={onExtract}
        />
      );

      const button = screen.getByRole('button', { name: /regenerate/i });
      await user.click(button);

      expect(onExtract).toHaveBeenCalledTimes(1);
    });

    it('shows Claude Code section when applicable', () => {
      const onExtract = vi.fn();
      const dataWithClaudeCode: ExtractionResult = {
        ...mockExtractionResult,
        claudeCode: {
          applicable: true,
          skills: [
            {
              name: 'Test Skill',
              description: 'A test skill',
              allowedTools: ['bash'],
              instructions: 'Do something',
            },
          ],
          commands: [],
          agents: [],
          hooks: [],
          rules: [],
        },
      };

      render(
        <InsightsPanel
          status="done"
          extractionData={dataWithClaudeCode}
          onExtract={onExtract}
        />
      );

      expect(screen.getByText('Claude Code Plugins')).toBeInTheDocument();
    });

    it('does not show Claude Code section when not applicable', () => {
      const onExtract = vi.fn();
      render(
        <InsightsPanel
          status="done"
          extractionData={mockExtractionResult}
          onExtract={onExtract}
        />
      );

      expect(screen.queryByText('Claude Code Plugins')).not.toBeInTheDocument();
    });
  });

  describe('Error State', () => {
    it('shows error message when status is error', () => {
      const onExtract = vi.fn();
      render(
        <InsightsPanel
          status="error"
          extractionData={{}}
          error="Failed to extract insights"
          onExtract={onExtract}
        />
      );

      // Check for heading
      expect(screen.getByRole('heading', { name: /failed to extract insights/i })).toBeInTheDocument();
    });

    it('shows retry button in error state', () => {
      const onExtract = vi.fn();
      render(
        <InsightsPanel
          status="error"
          extractionData={{}}
          error="Something went wrong"
          onExtract={onExtract}
        />
      );

      expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    });

    it('calls onExtract when retry button clicked', async () => {
      const user = userEvent.setup();
      const onExtract = vi.fn();
      render(
        <InsightsPanel
          status="error"
          extractionData={{}}
          error="Something went wrong"
          onExtract={onExtract}
        />
      );

      const button = screen.getByRole('button', { name: /try again/i });
      await user.click(button);

      expect(onExtract).toHaveBeenCalledTimes(1);
    });
  });

  describe('Knowledge Prompt Section', () => {
    it('shows knowledge prompt section when knowledgePrompt is present', () => {
      const onExtract = vi.fn();
      render(
        <InsightsPanel
          status="done"
          extractionData={mockExtractionResult}
          sectionStatuses={{
            summary: 'done',
            insights: 'done',
            actions: 'done',
            claudeCode: 'done',
            knowledgePrompt: 'done',
          }}
          onExtract={onExtract}
        />
      );

      expect(screen.getByText('Knowledge Prompt')).toBeInTheDocument();
    });

    it('displays knowledge prompt content', () => {
      const onExtract = vi.fn();
      render(
        <InsightsPanel
          status="done"
          extractionData={mockExtractionResult}
          sectionStatuses={{
            summary: 'done',
            insights: 'done',
            actions: 'done',
            claudeCode: 'done',
            knowledgePrompt: 'done',
          }}
          onExtract={onExtract}
        />
      );

      expect(screen.getByText(/This video teaches specific techniques/i)).toBeInTheDocument();
    });

    it('does not show knowledge prompt section when knowledgePrompt is undefined', () => {
      const onExtract = vi.fn();
      const dataWithoutKnowledgePrompt: ExtractionResult = {
        ...mockExtractionResult,
        knowledgePrompt: undefined,
      };

      render(
        <InsightsPanel
          status="done"
          extractionData={dataWithoutKnowledgePrompt}
          sectionStatuses={{
            summary: 'done',
            insights: 'done',
            actions: 'done',
            claudeCode: 'done',
            knowledgePrompt: 'done',
          }}
          onExtract={onExtract}
        />
      );

      expect(screen.queryByText('Knowledge Prompt')).not.toBeInTheDocument();
    });

    it('shows working status during streaming when knowledge prompt is being generated', () => {
      const onExtract = vi.fn();
      const partialData: Partial<ExtractionResult> = {
        ...mockExtractionResult,
        knowledgePrompt: 'This video teaches',
      };

      render(
        <InsightsPanel
          status="streaming"
          extractionData={partialData}
          sectionStatuses={{
            summary: 'done',
            insights: 'done',
            actions: 'done',
            claudeCode: 'done',
            knowledgePrompt: 'working',
          }}
          onExtract={onExtract}
        />
      );

      expect(screen.getByText('Knowledge Prompt')).toBeInTheDocument();
      // Check for working status indicator
      const section = screen.getByText('Knowledge Prompt').closest('div');
      expect(section).toBeInTheDocument();
    });

    it('shows pending status when knowledge prompt has not started yet', () => {
      const onExtract = vi.fn();
      const partialData: Partial<ExtractionResult> = {
        summary: mockExtractionResult.summary,
      };

      render(
        <InsightsPanel
          status="streaming"
          extractionData={partialData}
          sectionStatuses={{
            summary: 'done',
            insights: 'working',
            actions: 'pending',
            claudeCode: 'pending',
            knowledgePrompt: 'pending',
          }}
          onExtract={onExtract}
        />
      );

      expect(screen.getByText('Knowledge Prompt')).toBeInTheDocument();
    });
  });

  describe('Production Empty States', () => {
    const originalEnv = process.env.NEXT_PUBLIC_VERCEL_ENV

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.NEXT_PUBLIC_VERCEL_ENV
      } else {
        process.env.NEXT_PUBLIC_VERCEL_ENV = originalEnv
      }
    })

    describe('Generating state (production, video < 10 min old)', () => {
      it('shows "Insights are on their way" message when video is recent', () => {
        process.env.NEXT_PUBLIC_VERCEL_ENV = 'production'
        const onExtract = vi.fn()
        const recentDate = new Date(Date.now() - 3 * 60 * 1000) // 3 min ago

        render(
          <InsightsPanel
            status="idle"
            extractionData={{}}
            onExtract={onExtract}
            videoCreatedAt={recentDate}
          />
        )

        expect(screen.getByText('Insights are on their way')).toBeInTheDocument()
      })

      it('shows relative timestamp for a video added 3 minutes ago', () => {
        process.env.NEXT_PUBLIC_VERCEL_ENV = 'production'
        const onExtract = vi.fn()
        const recentDate = new Date(Date.now() - 3 * 60 * 1000)

        render(
          <InsightsPanel
            status="idle"
            extractionData={{}}
            onExtract={onExtract}
            videoCreatedAt={recentDate}
          />
        )

        expect(screen.getByText('Added 3 minutes ago')).toBeInTheDocument()
      })

      it('shows "Added just now" for video created within the last minute', () => {
        process.env.NEXT_PUBLIC_VERCEL_ENV = 'production'
        const onExtract = vi.fn()
        const justNow = new Date(Date.now() - 30 * 1000) // 30 sec ago

        render(
          <InsightsPanel
            status="idle"
            extractionData={{}}
            onExtract={onExtract}
            videoCreatedAt={justNow}
          />
        )

        expect(screen.getByText('Added just now')).toBeInTheDocument()
      })

      it('applies breathing animation class to Sparkles icon in generating state', () => {
        process.env.NEXT_PUBLIC_VERCEL_ENV = 'production'
        const onExtract = vi.fn()
        const recentDate = new Date(Date.now() - 2 * 60 * 1000)
        const { container } = render(
          <InsightsPanel
            status="idle"
            extractionData={{}}
            onExtract={onExtract}
            videoCreatedAt={recentDate}
          />
        )

        const sparkles = container.querySelector('svg.animate-breathe')
        expect(sparkles).toBeInTheDocument()
      })

      it('does not show an Extract button in generating state', () => {
        process.env.NEXT_PUBLIC_VERCEL_ENV = 'production'
        const onExtract = vi.fn()
        const recentDate = new Date(Date.now() - 2 * 60 * 1000)

        render(
          <InsightsPanel
            status="idle"
            extractionData={{}}
            onExtract={onExtract}
            videoCreatedAt={recentDate}
          />
        )

        expect(screen.queryByRole('button')).not.toBeInTheDocument()
      })
    })

    describe('Timeout state (production, video >= 10 min old)', () => {
      it('shows "Insights didn\'t arrive as expected" message when video is old', () => {
        process.env.NEXT_PUBLIC_VERCEL_ENV = 'production'
        const onExtract = vi.fn()
        const oldDate = new Date(Date.now() - 15 * 60 * 1000) // 15 min ago

        render(
          <InsightsPanel
            status="idle"
            extractionData={{}}
            onExtract={onExtract}
            videoCreatedAt={oldDate}
          />
        )

        expect(screen.getByText(/Insights didn.t arrive as expected/)).toBeInTheDocument()
      })

      it('shows "Generate Insights" button in timeout state', () => {
        process.env.NEXT_PUBLIC_VERCEL_ENV = 'production'
        const onExtract = vi.fn()
        const oldDate = new Date(Date.now() - 15 * 60 * 1000)

        render(
          <InsightsPanel
            status="idle"
            extractionData={{}}
            onExtract={onExtract}
            videoCreatedAt={oldDate}
          />
        )

        expect(screen.getByRole('button', { name: /generate insights/i })).toBeInTheDocument()
      })

      it('calls onExtract when Generate Insights button is clicked', async () => {
        const user = userEvent.setup()
        process.env.NEXT_PUBLIC_VERCEL_ENV = 'production'
        const onExtract = vi.fn()
        const oldDate = new Date(Date.now() - 15 * 60 * 1000)

        render(
          <InsightsPanel
            status="idle"
            extractionData={{}}
            onExtract={onExtract}
            videoCreatedAt={oldDate}
          />
        )

        await user.click(screen.getByRole('button', { name: /generate insights/i }))
        expect(onExtract).toHaveBeenCalledTimes(1)
      })

      it('shows timeout state at exactly 10 minutes old', () => {
        process.env.NEXT_PUBLIC_VERCEL_ENV = 'production'
        const onExtract = vi.fn()
        const exactlyTenMin = new Date(Date.now() - 10 * 60 * 1000)

        render(
          <InsightsPanel
            status="idle"
            extractionData={{}}
            onExtract={onExtract}
            videoCreatedAt={exactlyTenMin}
          />
        )

        expect(screen.getByText(/Insights didn.t arrive as expected/)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /generate insights/i })).toBeInTheDocument()
      })

      it('applies crossfade transition class in timeout state', () => {
        process.env.NEXT_PUBLIC_VERCEL_ENV = 'production'
        const onExtract = vi.fn()
        const oldDate = new Date(Date.now() - 15 * 60 * 1000)
        const { container } = render(
          <InsightsPanel
            status="idle"
            extractionData={{}}
            onExtract={onExtract}
            videoCreatedAt={oldDate}
          />
        )

        const wrapper = container.firstChild as HTMLElement
        expect(wrapper).toHaveClass('transition-opacity')
      })
    })

    describe('Local state (no VERCEL env)', () => {
      it('shows original empty state without VERCEL env', () => {
        delete process.env.NEXT_PUBLIC_VERCEL_ENV
        const onExtract = vi.fn()

        render(
          <InsightsPanel
            status="idle"
            extractionData={{}}
            onExtract={onExtract}
            videoCreatedAt={new Date(Date.now() - 2 * 60 * 1000)}
          />
        )

        expect(screen.getByText('No insights generated yet')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /extract insights/i })).toBeInTheDocument()
      })

      it('shows original empty state when videoCreatedAt is not provided', () => {
        process.env.NEXT_PUBLIC_VERCEL_ENV = 'production'
        const onExtract = vi.fn()

        render(
          <InsightsPanel
            status="idle"
            extractionData={{}}
            onExtract={onExtract}
          />
        )

        expect(screen.getByText('No insights generated yet')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /extract insights/i })).toBeInTheDocument()
      })

      it('shows original empty state with empty string VERCEL env', () => {
        process.env.NEXT_PUBLIC_VERCEL_ENV = ''
        const onExtract = vi.fn()

        render(
          <InsightsPanel
            status="idle"
            extractionData={{}}
            onExtract={onExtract}
            videoCreatedAt={new Date(Date.now() - 2 * 60 * 1000)}
          />
        )

        expect(screen.getByText('No insights generated yet')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /extract insights/i })).toBeInTheDocument()
      })
    })
  })

  describe('GPU Performance Optimizations', () => {
    it('adds will-change-transform to large spinner during streaming', () => {
      const onExtract = vi.fn();
      const { container } = render(
        <InsightsPanel
          status="streaming"
          extractionData={{}}
          onExtract={onExtract}
        />
      );

      // Find the large spinner (h-4 w-4 in the progress header)
      const spinner = container.querySelector('svg[class*="h-4"][class*="w-4"][class*="animate-spin"]');
      expect(spinner).toHaveClass('will-change-transform');
    });

    it('uses scoped transition on progress bar', () => {
      const onExtract = vi.fn();
      const { container } = render(
        <InsightsPanel
          status="streaming"
          extractionData={{}}
          sectionStatuses={{
            summary: 'done',
            insights: 'working',
            actions: 'pending',
            claudeCode: 'pending',
            knowledgePrompt: 'pending',
          }}
          onExtract={onExtract}
        />
      );

      // Find the progress bar (inner div with bg-blue-600)
      const progressBar = container.querySelector('div[class*="bg-blue-600"]');
      expect(progressBar).toHaveClass('transition-[width]');
      expect(progressBar?.className).not.toContain('transition-all');
    });
  });
});
