/**
 * Video Detail Page Tests
 *
 * Tests for:
 * 1. returnTo behavior (existing tests, preserved)
 * 2. generateMetadata output (new tests for server component)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { parseReturnTo } from '@/lib/navigation'

// --- Existing returnTo tests (preserved verbatim) ---
describe('VideoDetailPage returnTo behavior', () => {
  it('parseReturnTo correctly validates KB with search params', () => {
    const returnTo = parseReturnTo('/?q=react')
    expect(returnTo).toBe('/?q=react')
  })

  it('parseReturnTo correctly validates Discovery path', () => {
    const returnTo = parseReturnTo('/discovery')
    expect(returnTo).toBe('/discovery')
  })

  it('parseReturnTo rejects external URLs (open redirect protection)', () => {
    const returnTo = parseReturnTo('https://evil.com')
    expect(returnTo).toBeNull()
  })

  it('parseReturnTo rejects protocol-relative URLs', () => {
    const returnTo = parseReturnTo('//evil.com')
    expect(returnTo).toBeNull()
  })

  it('parseReturnTo handles null input', () => {
    const returnTo = parseReturnTo(null)
    expect(returnTo).toBeNull()
  })

  it('parseReturnTo handles encoded returnTo from KB search', () => {
    const encoded = encodeURIComponent('/?q=react&type=youtube')
    const returnTo = parseReturnTo(encoded)
    expect(returnTo).toBe('/?q=react&type=youtube')
  })

  it('parseReturnTo handles encoded returnTo from Discovery', () => {
    const encoded = encodeURIComponent('/discovery?channel=fireship')
    const returnTo = parseReturnTo(encoded)
    expect(returnTo).toBe('/discovery?channel=fireship')
  })
})

// --- New generateMetadata tests ---

// Mock next/navigation (notFound throws like Next.js does)
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }),
  useRouter: vi.fn(() => ({ push: vi.fn() })),
  useSearchParams: vi.fn(() => new URLSearchParams()),
}))

// Mock drizzle db module
const mockFrom = vi.fn()
const mockWhere = vi.fn()
const mockLimit = vi.fn()

vi.mock('@/lib/db', () => ({
  db: {
    select: () => ({ from: mockFrom }),
  },
  videos: { id: 'id' },
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col, val) => ({ col, val })),
}))

// Chain the query builder mocks
beforeEach(() => {
  vi.clearAllMocks()
  mockFrom.mockReturnValue({ where: mockWhere })
  mockWhere.mockReturnValue({ limit: mockLimit })
})

// Import after mocks are set up
const { generateMetadata } = await import('../page')

describe('generateMetadata', () => {
  const mockVideo = {
    id: 1,
    youtubeId: 'abc123',
    sourceType: 'youtube',
    title: 'Understanding React Server Components',
    channel: 'Fireship',
    thumbnail: 'https://i.ytimg.com/vi/abc123/hqdefault.jpg',
    duration: 600,
    description: 'A deep dive into React Server Components and how they change the way we build apps.',
    transcript: 'Hello everyone...',
    createdAt: new Date('2026-01-15'),
    updatedAt: new Date('2026-01-15'),
    publishedAt: new Date('2026-01-14'),
  }

  it('returns video title and description for a valid video', async () => {
    mockLimit.mockResolvedValue([mockVideo])

    const metadata = await generateMetadata({
      params: Promise.resolve({ id: '1' }),
    })

    expect(metadata.title).toBe('Understanding React Server Components | Sluice')
    expect(metadata.description).toContain('Fireship')
    expect(metadata.description).toContain('A deep dive into React Server Components')
  })

  it('includes YouTube thumbnail as OG image when available', async () => {
    mockLimit.mockResolvedValue([mockVideo])

    const metadata = await generateMetadata({
      params: Promise.resolve({ id: '1' }),
    })

    expect(metadata.openGraph?.images).toEqual([
      {
        url: 'https://i.ytimg.com/vi/abc123/hqdefault.jpg',
        width: 480,
        height: 360,
        alt: 'Understanding React Server Components',
      },
    ])
  })

  it('uses summary_large_image twitter card when thumbnail exists', async () => {
    mockLimit.mockResolvedValue([mockVideo])

    const metadata = await generateMetadata({
      params: Promise.resolve({ id: '1' }),
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((metadata.twitter as any)?.card).toBe('summary_large_image')
  })

  it('omits OG image for videos without thumbnails (transcript entries)', async () => {
    mockLimit.mockResolvedValue([{
      ...mockVideo,
      thumbnail: null,
      sourceType: 'transcript',
      channel: null,
    }])

    const metadata = await generateMetadata({
      params: Promise.resolve({ id: '1' }),
    })

    expect(metadata.openGraph?.images).toBeUndefined()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((metadata.twitter as any)?.card).toBe('summary')
  })

  it('returns fallback title for missing video', async () => {
    mockLimit.mockResolvedValue([])

    const metadata = await generateMetadata({
      params: Promise.resolve({ id: '999' }),
    })

    expect(metadata.title).toBe('Video Not Found | Sluice')
  })

  it('returns fallback title for invalid (non-numeric) video ID', async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ id: 'not-a-number' }),
    })

    expect(metadata.title).toBe('Video Not Found | Sluice')
    // Should not even attempt DB query for non-numeric ID
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('rejects mixed alphanumeric IDs like "1abc"', async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ id: '1abc' }),
    })

    expect(metadata.title).toBe('Video Not Found | Sluice')
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('uses "Watch on Sluice" fallback when video has no description', async () => {
    mockLimit.mockResolvedValue([{
      ...mockVideo,
      description: null,
    }])

    const metadata = await generateMetadata({
      params: Promise.resolve({ id: '1' }),
    })

    expect(metadata.description).toContain('Watch on Sluice')
  })

  it('truncates long descriptions to 150 characters', async () => {
    const longDescription = 'A'.repeat(200)
    mockLimit.mockResolvedValue([{
      ...mockVideo,
      description: longDescription,
    }])

    const metadata = await generateMetadata({
      params: Promise.resolve({ id: '1' }),
    })

    // Description is "Fireship — " + first 150 chars
    expect(metadata.description!.length).toBeLessThanOrEqual(162) // "Fireship — " (11) + 150 + " — " (4) = 161... let's be safe
  })
})
