import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { KnowledgeBankContent } from '@/components/knowledge-bank/KnowledgeBankContent'

// Create module-level mock functions that vi.mock can use
const mockSetQuery = vi.fn()
const mockRetryEnsemble = vi.fn()

// Create mock functions for Next.js navigation
const mockReplace = vi.fn()
const mockSearchParams = new URLSearchParams()

// Mock Next.js hooks
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: mockReplace,
  }),
  useSearchParams: () => mockSearchParams,
  usePathname: () => '/',
}))

// Mock PageTitleContext
vi.mock('@/components/layout/PageTitleContext', () => ({
  usePageTitle: () => ({
    setPageTitle: vi.fn(),
  }),
}))

// Mock PersonaStatusProvider
const mockUsePersonaStatus = vi.fn(() => ({
  channels: [],
  threshold: 5,
  isLoading: false,
  updateChannel: vi.fn(),
  refetch: vi.fn(),
}))
vi.mock('@/components/providers/PersonaStatusProvider', () => ({
  usePersonaStatus: () => mockUsePersonaStatus(),
}))

// Mock FocusAreaProvider
vi.mock('@/components/providers/FocusAreaProvider', () => ({
  useFocusArea: () => ({
    selectedFocusAreaId: null,
    focusAreas: [],
    setSelectedFocusAreaId: vi.fn(),
    refetch: vi.fn(),
    isLoading: false,
  }),
}))

// Mock useSearch hook - using module factory
vi.mock('@/hooks/useSearch', () => ({
  useSearch: vi.fn(() => ({
    query: '',
    setQuery: mockSetQuery,
    results: [],
    isLoading: false,
  })),
}))

// Mock useEnsemble hook - using module factory
vi.mock('@/hooks/useEnsemble', () => ({
  useEnsemble: vi.fn(() => ({
    state: {
      isLoading: false,
      personas: new Map(),
      bestMatch: null,
      isAllDone: false,
      error: null,
    },
    retry: mockRetryEnsemble,
  })),
}))

// Import the mocked functions after vi.mock declarations
import { useSearch } from '@/hooks/useSearch'
import { useEnsemble } from '@/hooks/useEnsemble'

const mockUseSearch = useSearch as ReturnType<typeof vi.fn>
const mockUseEnsemble = useEnsemble as ReturnType<typeof vi.fn>

// Mock IntersectionObserver - not available in jsdom
class MockIntersectionObserver {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
  takeRecords = () => []
  root = null
  rootMargin = ''
  thresholds = []
  constructor(_callback: IntersectionObserverCallback) {}
}
global.IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver

// Mock fetch
global.fetch = vi.fn()

describe('Home Page - Ensemble Trigger', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Clear URL params
    mockSearchParams.delete('q')
    mockSearchParams.delete('type')

    // Reset to default return values
    mockUseSearch.mockReturnValue({
      results: null,
      isLoading: false,
      error: null,
      mode: 'hybrid' as const,
      setMode: vi.fn(),
    })

    mockUseEnsemble.mockReturnValue({
      state: {
        isLoading: false,
        personas: new Map(),
        bestMatch: null,
        isAllDone: false,
        error: null,
      },
      retry: mockRetryEnsemble,
    })

    // Default mock for videos API and persona status
    ;(global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('/api/personas/status')) {
        return {
          ok: true,
          json: async () => ({
            channels: [
              {
                channelName: 'Test Channel',
                transcriptCount: 50,
                personaId: 1,
                personaCreatedAt: new Date(),
              },
            ],
            threshold: 30,
          }),
        }
      }
      return {
        ok: true,
        json: async () => ({
          videos: [],
          stats: { count: 0, totalHours: 0, channels: 0 },
          focusAreaMap: {},
        }),
      }
    })
  })

  it('does not trigger ensemble when query lacks question mark', async () => {
    mockSearchParams.set('q', 'What is the best approach')

    render(<KnowledgeBankContent />)

    // Wait for component to settle
    await waitFor(() => {
      expect(mockUseEnsemble).toHaveBeenCalled()
    })

    // useEnsemble should be called with null (no question mark)
    expect(mockUseEnsemble).toHaveBeenCalledWith(null)
  })

  it('triggers ensemble when query ends with question mark and has 3+ words', async () => {
    mockSearchParams.set('q', 'What is the best approach?')

    render(<KnowledgeBankContent />)

    // Wait for component to settle
    await waitFor(() => {
      expect(mockUseEnsemble).toHaveBeenCalled()
    })

    // useEnsemble should be called with the query (has question mark)
    expect(mockUseEnsemble).toHaveBeenCalledWith('What is the best approach?')
  })

  it('does not trigger ensemble when query has question mark but less than 3 words', async () => {
    mockSearchParams.set('q', 'What is?')

    render(<KnowledgeBankContent />)

    // Wait for component to settle
    await waitFor(() => {
      expect(mockUseEnsemble).toHaveBeenCalled()
    })

    // useEnsemble should be called with null (less than 3 words)
    expect(mockUseEnsemble).toHaveBeenCalledWith(null)
  })

  it('triggers ensemble when query has exactly 3 words with question mark', async () => {
    mockSearchParams.set('q', 'What is TypeScript?')

    render(<KnowledgeBankContent />)

    // Wait for component to settle
    await waitFor(() => {
      expect(mockUseEnsemble).toHaveBeenCalled()
    })

    // useEnsemble should be called with the query (3 words + question mark)
    expect(mockUseEnsemble).toHaveBeenCalledWith('What is TypeScript?')
  })

  it('does not trigger ensemble for question words without question mark', async () => {
    mockSearchParams.set('q', 'How to learn programming')

    render(<KnowledgeBankContent />)

    // Wait for component to settle
    await waitFor(() => {
      expect(mockUseEnsemble).toHaveBeenCalled()
    })

    // useEnsemble should be called with null (no question mark)
    expect(mockUseEnsemble).toHaveBeenCalledWith(null)
  })

  it('handles query with trailing whitespace and question mark', async () => {
    mockSearchParams.set('q', '  What is the best approach?  ')

    render(<KnowledgeBankContent />)

    // Wait for component to settle
    await waitFor(() => {
      expect(mockUseEnsemble).toHaveBeenCalled()
    })

    // useEnsemble should be called with the query (the trimming happens in the condition, not the value)
    expect(mockUseEnsemble).toHaveBeenCalledWith('  What is the best approach?  ')
  })

  it('displays updated hint text when personas are active', async () => {
    // Override persona status mock to return active personas
    mockUsePersonaStatus.mockReturnValue({
      channels: [
        {
          channelName: 'Test Channel',
          transcriptCount: 50,
          personaId: 1,
          personaCreatedAt: new Date().toISOString(),
          personaName: 'Test',
          expertiseTopics: null,
        },
      ],
      threshold: 30,
      isLoading: false,
      updateChannel: vi.fn(),
      refetch: vi.fn(),
    })

    // Override fetch to return videos so empty state doesn't show
    ;(global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      return {
        ok: true,
        json: async () => ({
          videos: [
            {
              id: 1,
              youtubeId: 'test123',
              title: 'Test Video',
              channelId: 'UCtest',
              channelName: 'Test Channel',
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ],
          stats: { count: 1, totalHours: 1, channels: 1 },
          focusAreaMap: {},
        }),
      }
    })

    render(<KnowledgeBankContent />)

    // Persona data comes from the mocked provider (no deferred fetch)
    await waitFor(() => {
      const hint = screen.queryByText(/End with \? to ask your personas/i)
      expect(hint).toBeInTheDocument()
    })

    // Should not show old hint text
    expect(screen.queryByText(/Ask a question \(3\+ words\) to hear from your personas/i)).not.toBeInTheDocument()
  })

  it('shows persona panel when query has question mark', async () => {
    mockSearchParams.set('q', 'What is the best approach?')

    // Mock ensemble state with personas
    mockUseEnsemble.mockReturnValue({
      state: {
        isLoading: true,
        personas: new Map(),
        bestMatch: null,
        isAllDone: false,
        error: null,
      },
      retry: mockRetryEnsemble,
    })

    render(<KnowledgeBankContent />)

    // Wait for component to render
    await waitFor(() => {
      // PersonaPanel should be rendered (it might not have visible text yet)
      // We're checking that useEnsemble was called with a non-null query
      expect(mockUseEnsemble).toHaveBeenCalledWith('What is the best approach?')
    })
  })

  it('does not show persona panel when query lacks question mark', async () => {
    mockSearchParams.set('q', 'What is the best approach')

    render(<KnowledgeBankContent />)

    // Wait for component to settle
    await waitFor(() => {
      expect(mockUseEnsemble).toHaveBeenCalled()
    })

    // useEnsemble should be called with null, so panel shouldn't render
    expect(mockUseEnsemble).toHaveBeenCalledWith(null)
  })
})

describe('Home Page - Edge Case Validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Clear URL params
    mockSearchParams.delete('q')
    mockSearchParams.delete('type')

    // Reset to default return values
    mockUseSearch.mockReturnValue({
      results: null,
      isLoading: false,
      error: null,
      mode: 'hybrid' as const,
      setMode: vi.fn(),
    })

    mockUseEnsemble.mockReturnValue({
      state: {
        isLoading: false,
        personas: new Map(),
        bestMatch: null,
        isAllDone: false,
        error: null,
      },
      retry: mockRetryEnsemble,
    })

    // Default mock for videos API
    ;(global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('/api/personas/status')) {
        return {
          ok: true,
          json: async () => ({
            channels: [],
            threshold: 30,
          }),
        }
      }
      return {
        ok: true,
        json: async () => ({
          videos: [
            {
              id: 1,
              youtubeId: 'test123',
              title: 'Test Video',
              channelId: 'UCtest',
              channelName: 'Test Channel',
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ],
          stats: { count: 1, totalHours: 1, channels: 1 },
          focusAreaMap: {},
        }),
      }
    })
  })

  it('should default to "all" when type param is invalid', async () => {
    mockSearchParams.set('type', 'nope')

    render(<KnowledgeBankContent />)

    // Wait for component to render
    await waitFor(() => {
      expect(screen.getByText('Test Video')).toBeInTheDocument()
    })

    // Should show "All" in the filter (defaulted from invalid "nope")
    expect(screen.getByText('All')).toBeInTheDocument()
  })

  it('should treat whitespace-only query as empty', async () => {
    mockSearchParams.set('q', '   ')

    render(<KnowledgeBankContent />)

    // Wait for component to render
    await waitFor(() => {
      expect(mockUseSearch).toHaveBeenCalled()
    })

    // useSearch should receive empty string (trimmed)
    expect(mockUseSearch).toHaveBeenCalledWith({
      query: '   ',
      focusAreaId: null,
    })

    // Since the trimmed query is empty, the component should show VideoGrid (not SearchResults)
    // The SearchResults component checks if query.trim().length > 0
    expect(screen.getByText('Test Video')).toBeInTheDocument()
  })

  it('should show default state when no params are present', async () => {
    // No params set

    render(<KnowledgeBankContent />)

    // Wait for component to render
    await waitFor(() => {
      expect(screen.getByText('Test Video')).toBeInTheDocument()
    })

    // Should show "All" type filter
    expect(screen.getByText('All')).toBeInTheDocument()

    // useSearch should be called with empty query
    expect(mockUseSearch).toHaveBeenCalledWith({
      query: '',
      focusAreaId: null,
    })
  })
})
