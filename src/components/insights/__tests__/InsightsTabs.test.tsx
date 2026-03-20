import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InsightsTabs } from '../InsightsTabs';
import { AgentProvider } from '@/lib/agent/AgentProvider';
import { ExtractionProvider } from '@/components/providers/ExtractionProvider';
import type { Video } from '@/lib/db/schema';

// Mock fetch for agent token
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock AgentConnection
vi.mock('@/lib/agent/connection', () => {
  class MockAgentConnection {
    private statusCallback: ((status: string) => void) | null = null;

    onStatusChange(callback: (status: string) => void) {
      this.statusCallback = callback;
      return () => {
        this.statusCallback = null;
      };
    }

    async connect() {
      // Simulate successful connection
      if (this.statusCallback) {
        this.statusCallback('connected');
      }
    }

    disconnect() {
      // no-op
    }

    generateInsight() {
      return 'mock-id';
    }

    cancelInsight() {
      // no-op
    }
  }

  return {
    AgentConnection: MockAgentConnection,
  };
});

const mockVideo: Video = {
  id: 1,
  youtubeId: 'test123',
  sourceType: 'youtube',
  title: 'Test Video',
  channel: 'Test Channel',
  thumbnail: 'https://example.com/thumb.jpg',
  duration: 300,
  description: null,
  transcript: '0:00\nIntro\n1:00\nContent',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
  publishedAt: null,
};

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <AgentProvider>
      <ExtractionProvider>
        {children}
      </ExtractionProvider>
    </AgentProvider>
  );
}

describe('InsightsTabs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();

    // Mock all fetch calls
    mockFetch.mockImplementation((url: string) => {
      // Agent token endpoint - return available by default
      if (url.includes('/api/agent/token')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ available: true, token: 'mock-token' }),
        });
      }
      // Insights endpoint - return no insights by default
      if (url.includes('/insights')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ extraction: null, generatedAt: null }),
        });
      }
      return Promise.reject(new Error('Unknown endpoint'));
    });
  });

  it('renders both tabs', () => {
    const onSeek = vi.fn();
    render(
      <Wrapper>
        <InsightsTabs video={mockVideo} onSeek={onSeek} />
      </Wrapper>
    );

    expect(screen.getByRole('tab', { name: /transcript/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /insights/i })).toBeInTheDocument();
  });

  it('shows Insights tab content by default', () => {
    const onSeek = vi.fn();
    render(
      <Wrapper>
        <InsightsTabs video={mockVideo} onSeek={onSeek} />
      </Wrapper>
    );

    // Insights tab should be active by default
    expect(screen.getByRole('tab', { name: /insights/i })).toHaveAttribute('data-state', 'active');
  });

  it('switches to Transcript tab when clicked', async () => {
    const user = userEvent.setup();
    const onSeek = vi.fn();
    render(
      <Wrapper>
        <InsightsTabs video={mockVideo} onSeek={onSeek} />
      </Wrapper>
    );

    const transcriptTab = screen.getByRole('tab', { name: /transcript/i });
    await user.click(transcriptTab);

    // Transcript content should be visible
    expect(screen.getByText('Intro')).toBeInTheDocument();
  });

  it('passes video transcript to TranscriptView', async () => {
    const user = userEvent.setup();
    const onSeek = vi.fn();
    render(
      <Wrapper>
        <InsightsTabs video={mockVideo} onSeek={onSeek} />
      </Wrapper>
    );

    // Switch to Transcript tab first (Insights is default)
    const transcriptTab = screen.getByRole('tab', { name: /transcript/i });
    await user.click(transcriptTab);

    // Content from transcript should be visible
    expect(screen.getByText('Intro')).toBeInTheDocument();
    expect(screen.getByText('Content')).toBeInTheDocument();
  });

  it('passes onSeek callback to TranscriptView', async () => {
    const user = userEvent.setup();
    const onSeek = vi.fn();
    render(
      <Wrapper>
        <InsightsTabs video={mockVideo} onSeek={onSeek} />
      </Wrapper>
    );

    // Switch to Transcript tab first (Insights is default)
    const transcriptTab = screen.getByRole('tab', { name: /transcript/i });
    await user.click(transcriptTab);

    // Click on a timestamp button
    const timestampButton = screen.getByRole('button', { name: '0:00' });
    await user.click(timestampButton);

    expect(onSeek).toHaveBeenCalledWith(0);
  });

  it('handles video with no transcript', async () => {
    const user = userEvent.setup();
    const onSeek = vi.fn();
    const videoNoTranscript: Video = {
      ...mockVideo,
      transcript: null,
    };
    render(
      <Wrapper>
        <InsightsTabs video={videoNoTranscript} onSeek={onSeek} />
      </Wrapper>
    );

    // Switch to Transcript tab first (Insights is default)
    const transcriptTab = screen.getByRole('tab', { name: /transcript/i });
    await user.click(transcriptTab);

    expect(screen.getByText('No transcript available')).toBeInTheDocument();
  });

  it('maintains tab state when switching back and forth', async () => {
    const user = userEvent.setup();
    const onSeek = vi.fn();
    render(
      <Wrapper>
        <InsightsTabs video={mockVideo} onSeek={onSeek} />
      </Wrapper>
    );

    // Start on Insights tab (default)
    expect(screen.getByRole('tab', { name: /insights/i })).toHaveAttribute('data-state', 'active');

    // Switch to Transcript
    const transcriptTab = screen.getByRole('tab', { name: /transcript/i });
    await user.click(transcriptTab);
    expect(screen.getByText('Intro')).toBeInTheDocument();

    // Switch back to Insights
    const insightsTab = screen.getByRole('tab', { name: /insights/i });
    await user.click(insightsTab);
    expect(screen.getByRole('tab', { name: /insights/i })).toHaveAttribute('data-state', 'active');
  });

  it('threads video.createdAt to InsightsPanel as videoCreatedAt', () => {
    const originalEnv = process.env.NEXT_PUBLIC_VERCEL;
    process.env.NEXT_PUBLIC_VERCEL = '1';
    try {
      const onSeek = vi.fn();
      const recentVideo = {
        ...mockVideo,
        createdAt: new Date(Date.now() - 2 * 60 * 1000), // 2 min ago
      };
      render(
        <Wrapper>
          <InsightsTabs video={recentVideo} onSeek={onSeek} />
        </Wrapper>
      );

      // With NEXT_PUBLIC_VERCEL set and a recent createdAt, the generating state
      // renders - proving createdAt was threaded through to InsightsPanel.
      expect(screen.getByText('Insights are on their way')).toBeInTheDocument();
    } finally {
      if (originalEnv === undefined) {
        delete process.env.NEXT_PUBLIC_VERCEL;
      } else {
        process.env.NEXT_PUBLIC_VERCEL = originalEnv;
      }
    }
  });
});
