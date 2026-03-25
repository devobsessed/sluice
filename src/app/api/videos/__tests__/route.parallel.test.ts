/**
 * Tests that focusAreaMap and summaryMap queries run concurrently in the GET handler.
 *
 * Strategy: mock `db` with a controlled delay implementation that records the order
 * in which query chains are *started* vs *resolved*. If both start before either
 * resolves, the queries are parallel (Promise.all). If the second start only happens
 * after the first resolves, the queries are sequential (awaited individually).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth-guards', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth-guards')>()
  return {
    ...actual,
    requireSession: vi.fn().mockResolvedValue(null),
  }
})

// ---- Mock next/server -------------------------------------------------------
vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server')
  return { ...actual, after: vi.fn() }
})

// ---- Mock metadata fetcher --------------------------------------------------
vi.mock('@/lib/youtube/metadata', () => ({
  fetchVideoPageMetadata: vi.fn().mockResolvedValue({}),
}))

// ---- Mock embeddings pipeline -----------------------------------------------
vi.mock('@/lib/embeddings/pipeline', () => ({
  generateEmbedding: vi.fn().mockResolvedValue(new Float32Array(384).fill(0)),
}))

// ---- Shared tracking state --------------------------------------------------
// Records the sequence of events so we can assert ordering.
const events: string[] = []

// Each mock promise deferred so we control when they resolve.
type Deferred<T> = { resolve: (v: T) => void; promise: Promise<T> }

function makeDeferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { resolve, promise }
}

// We'll rebuild these for each test via beforeEach.
let focusAreaDeferred: Deferred<unknown[]>
let insightDeferred: Deferred<unknown[]>

// ---- Mock @/lib/db ----------------------------------------------------------
// searchVideos returns one video (id=1) so videoIds.length > 0 and the parallel
// block is entered. The actual select() chain is mocked per-call.

// We need the mock to behave differently for:
//   call 1: searchVideos query (from the search lib — but we mock that separately)
//   call 2: focusArea assignments query (innerJoin path)
//   call 3: insights query (insights path)
//
// Because searchVideos / getVideoStats are mocked via @/lib/db/search, the
// db.select calls we see are only the two parallel ones inside GET.

let selectCallIndex = 0

vi.mock('@/lib/db', async () => {
  const actual = await vi.importActual<typeof import('@/lib/db')>('@/lib/db')

  const mockDb = {
    select: vi.fn(() => {
      const idx = selectCallIndex++

      if (idx === 0) {
        // First db.select call inside GET: the focusArea assignments query
        events.push('focusArea:started')
        return {
          from: vi.fn().mockReturnThis(),
          innerJoin: vi.fn().mockReturnThis(),
          where: vi.fn(() => {
            return focusAreaDeferred.promise.then((rows) => {
              events.push('focusArea:resolved')
              return rows
            })
          }),
        }
      } else {
        // Second db.select call inside GET: the insights query
        events.push('insights:started')
        return {
          from: vi.fn().mockReturnThis(),
          where: vi.fn(() => {
            return insightDeferred.promise.then((rows) => {
              events.push('insights:resolved')
              return rows
            })
          }),
        }
      }
    }),
  }

  return {
    ...actual,
    db: mockDb,
    videoFocusAreas: actual.videoFocusAreas,
    focusAreas: actual.focusAreas,
    insights: actual.insights,
  }
})

// ---- Mock @/lib/db/search ---------------------------------------------------
// Returns one video so the parallel block is exercised.
vi.mock('@/lib/db/search', () => ({
  searchVideos: vi.fn().mockResolvedValue({
    items: [
      {
        id: 1,
        youtubeId: 'test-video',
        title: 'Test Video',
        channel: 'Test Channel',
        thumbnail: null,
        duration: null,
        description: null,
        publishedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    hasMore: false,
    nextCursor: null,
  }),
  getVideoStats: vi.fn().mockResolvedValue({ count: 1, channels: 1 }),
  getDistinctChannels: vi.fn().mockResolvedValue([]),
}))

// Import AFTER mocks are registered
const { GET } = await import('../route')

// ---- Tests ------------------------------------------------------------------
describe('GET /api/videos — parallel query execution', () => {
  beforeEach(() => {
    events.length = 0
    selectCallIndex = 0
    focusAreaDeferred = makeDeferred()
    insightDeferred = makeDeferred()
  })

  it('starts focusAreaMap and summaryMap queries before either resolves (proves parallel execution)', async () => {
    // Kick off the GET request but don't await it yet — we'll drive resolution manually.
    const requestPromise = GET(new Request('http://localhost/api/videos'))

    // Yield to microtask queue so the GET handler progresses to the await point.
    // We give it a small delay to let the async function reach the parallel block.
    await new Promise((r) => setTimeout(r, 10))

    // At this point both queries should have started (been scheduled).
    // If they run sequentially, only the first would have started.
    expect(events).toContain('focusArea:started')
    expect(events).toContain('insights:started')

    // Neither should have resolved yet because we haven't resolved their deferreds.
    expect(events).not.toContain('focusArea:resolved')
    expect(events).not.toContain('insights:resolved')

    // Now resolve both and let the handler finish.
    focusAreaDeferred.resolve([])
    insightDeferred.resolve([])

    const response = await requestPromise
    expect(response.status).toBe(200)

    // Both should now be resolved.
    expect(events).toContain('focusArea:resolved')
    expect(events).toContain('insights:resolved')

    // The critical assertion: focusArea:started and insights:started both appeared
    // BEFORE focusArea:resolved and insights:resolved. This is only possible when
    // both queries were launched concurrently (via Promise.all).
    const focusAreaStartedIdx = events.indexOf('focusArea:started')
    const insightsStartedIdx = events.indexOf('insights:started')
    const focusAreaResolvedIdx = events.indexOf('focusArea:resolved')
    const insightsResolvedIdx = events.indexOf('insights:resolved')

    // Both queries started before either resolved
    expect(focusAreaStartedIdx).toBeLessThan(focusAreaResolvedIdx)
    expect(insightsStartedIdx).toBeLessThan(insightsResolvedIdx)
    // insights:started appears before focusArea:resolved (proves overlap)
    expect(insightsStartedIdx).toBeLessThan(focusAreaResolvedIdx)
  })

  it('returns correct response shape with focusAreaMap and summaryMap', async () => {
    const requestPromise = GET(new Request('http://localhost/api/videos'))

    await new Promise((r) => setTimeout(r, 10))
    focusAreaDeferred.resolve([])
    insightDeferred.resolve([])

    const response = await requestPromise
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toHaveProperty('videos')
    expect(data).toHaveProperty('stats')
    expect(data).toHaveProperty('focusAreaMap')
    expect(data).toHaveProperty('summaryMap')
    expect(data.focusAreaMap).toEqual({})
    expect(data.summaryMap).toEqual({})
  })

  it('populates focusAreaMap and summaryMap from parallel query results', async () => {
    // Reset to allow custom mock data
    selectCallIndex = 0

    const focusAreaRows = [
      { videoId: 1, id: 10, name: 'React', color: '#61dafb' },
    ]
    const insightRows = [
      {
        videoId: 1,
        extraction: { summary: { tldr: 'A React-focused video.' } },
      },
    ]

    // Override deferreds with pre-resolved values
    focusAreaDeferred.resolve(focusAreaRows)
    insightDeferred.resolve(insightRows)

    const response = await GET(new Request('http://localhost/api/videos'))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.focusAreaMap).toEqual({
      1: [{ id: 10, name: 'React', color: '#61dafb' }],
    })
    expect(data.summaryMap).toEqual({
      1: 'A React-focused video.',
    })
  })
})
