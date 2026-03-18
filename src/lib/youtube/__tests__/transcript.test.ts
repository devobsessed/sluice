import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { fetchTranscript, clearTranscriptCache } from '../transcript'

// Mock global fetch for InnerTube API calls
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function mockInnerTubeSuccess(segments: Array<{ text: string; start: number; dur: number }>) {
  // First call: InnerTube player API → returns caption tracks
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [{ languageCode: 'en', kind: 'asr', baseUrl: 'https://youtube.com/api/timedtext?v=test' }],
        },
      },
    }),
  })

  // Second call: transcript XML
  const xml = segments
    .map((s) => `<text start="${s.start}" dur="${s.dur}">${s.text}</text>`)
    .join('')
  mockFetch.mockResolvedValueOnce({
    ok: true,
    text: async () => `<?xml version="1.0"?><transcript>${xml}</transcript>`,
  })
}

function mockInnerTubeASRSuccess(segments: Array<{ text: string; t: number; d: number }>) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [{ languageCode: 'en', kind: 'asr', baseUrl: 'https://youtube.com/api/timedtext?v=test' }],
        },
      },
    }),
  })

  const xml = segments
    .map((s) => `<p t="${s.t}" d="${s.d}"><s>${s.text}</s></p>`)
    .join('')
  mockFetch.mockResolvedValueOnce({
    ok: true,
    text: async () => `<?xml version="1.0"?><timedtext><body>${xml}</body></timedtext>`,
  })
}

function mockInnerTubeNoCaptions() {
  // ANDROID client returns no captions
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({ playabilityStatus: { status: 'OK' }, captions: null }),
  })
  // WEB client also returns no captions
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({ playabilityStatus: { status: 'OK' }, captions: null }),
  })
}

function mockInnerTubeHTTPRejection(file_status = 403) {
  mockFetch.mockResolvedValueOnce({ ok: false, status: file_status, json: async () => ({}) })
  mockFetch.mockResolvedValueOnce({ ok: false, status: file_status, json: async () => ({}) })
}

function mockInnerTubeFetchError() {
  // Both clients fail with network error
  mockFetch.mockRejectedValueOnce(new Error('Network timeout'))
  mockFetch.mockRejectedValueOnce(new Error('Network timeout'))
}

describe('fetchTranscript', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns transcript data with standard XML format', async () => {
    mockInnerTubeSuccess([
      { text: 'Hello world', start: 0, dur: 2 },
      { text: 'This is a test', start: 2, dur: 3 },
      { text: 'Great video', start: 5, dur: 2 },
    ])

    const result = await fetchTranscript('test-video-id')

    expect(result.success).toBe(true)
    expect(result.transcript).toContain('0:00\nHello world')
    expect(result.transcript).toContain('0:02\nThis is a test')
    expect(result.transcript).toContain('0:05\nGreat video')
    expect(result.segments).toHaveLength(3)
    expect(result.segments[0]).toEqual({
      timestamp: '0:00',
      seconds: 0,
      text: 'Hello world',
    })
    expect(result.language).toBe('en')
    expect(result.error).toBeUndefined()
  })

  it('returns transcript data with ASR XML format', async () => {
    mockInnerTubeASRSuccess([
      { text: 'Hello ASR', t: 0, d: 2000 },
      { text: 'Auto generated', t: 2000, d: 3000 },
    ])

    const result = await fetchTranscript('asr-video')

    expect(result.success).toBe(true)
    expect(result.segments).toHaveLength(2)
    expect(result.segments[0]).toEqual({
      timestamp: '0:00',
      seconds: 0,
      text: 'Hello ASR',
    })
    expect(result.segments[1]).toEqual({
      timestamp: '0:02',
      seconds: 2,
      text: 'Auto generated',
    })
  })

  it('formats timestamps correctly for hours', async () => {
    mockInnerTubeSuccess([
      { text: 'Start', start: 0, dur: 1 },
      { text: 'One hour mark', start: 3600, dur: 1 },
      { text: 'Hour and half', start: 5445, dur: 1 },
    ])

    const result = await fetchTranscript('long-video')

    expect(result.success).toBe(true)
    expect(result.segments[0]?.timestamp).toBe('0:00')
    expect(result.segments[1]?.timestamp).toBe('1:00:00')
    expect(result.segments[2]?.timestamp).toBe('1:30:45')
  })

  it('handles disabled transcripts (no caption tracks)', async () => {
    mockInnerTubeNoCaptions()

    const result = await fetchTranscript('disabled-video')

    expect(result.success).toBe(false)
    expect(result.transcript).toBeNull()
    expect(result.error).toBe('Transcripts are not available for this video')
  })

  it('handles HTTP rejection from YouTube API', async () => {
    mockInnerTubeHTTPRejection(403)
    const result = await fetchTranscript('rejected-video')
    expect(result.success).toBe(false)
    expect(result.error).toBe('YouTube API rejected the request - InnerTube client versions may be outdated')
  })

  it('handles HTTP 429 rate limit from YouTube API', async () => {
    mockInnerTubeHTTPRejection(429)
    const result = await fetchTranscript('ratelimited-video')
    expect(result.success).toBe(false)
    expect(result.error).toBe('YouTube API rejected the request - InnerTube client versions may be outdated')
  })

  it('falls back to second client when first gets HTTP rejection', async () => {
    // ANDROID gets 403
    mockFetch.mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({}) })
    // WEB succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        captions: {
          playerCaptionsTracklistRenderer: {
            captionTracks: [{ languageCode: 'en', kind: 'asr', baseUrl: 'https://youtube.com/api/timedtext?v=test' }],
          },
        },
      }),
    })
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => '<?xml version="1.0"?><transcript><text start="0" dur="1">Fallback works</text></transcript>',
    })
    const result = await fetchTranscript('fallback-video')
    expect(result.success).toBe(true)
    expect(result.transcript).toContain('Fallback works')
    expect(mockFetch).toHaveBeenCalledTimes(3)
  })

  it('handles network errors gracefully', async () => {
    mockInnerTubeFetchError()

    const result = await fetchTranscript('error-video')

    expect(result.success).toBe(false)
    expect(result.error).toContain('Failed to fetch transcript')
    expect(result.error).toContain('Network timeout')
  })

  it('decodes HTML entities in transcript text', async () => {
    mockInnerTubeSuccess([
      { text: 'He said &quot;hello&quot; &amp; goodbye', start: 0, dur: 2 },
      { text: 'It&#39;s a test &lt;tag&gt;', start: 2, dur: 1 },
    ])

    const result = await fetchTranscript('entities-video')

    expect(result.success).toBe(true)
    expect(result.segments[0]?.text).toBe('He said "hello" & goodbye')
    expect(result.segments[1]?.text).toBe("It's a test <tag>")
  })

  it('caches successful results', async () => {
    mockInnerTubeSuccess([
      { text: 'Cached content', start: 0, dur: 1 },
    ])

    const result1 = await fetchTranscript('cached-video')
    expect(result1.success).toBe(true)
    expect(result1.fromCache).toBeUndefined()
    expect(mockFetch).toHaveBeenCalledTimes(2) // player + xml

    const result2 = await fetchTranscript('cached-video')
    expect(result2.success).toBe(true)
    expect(result2.fromCache).toBe(true)
    expect(mockFetch).toHaveBeenCalledTimes(2) // Not called again
  })

  it('caches failures briefly', async () => {
    mockInnerTubeNoCaptions()

    const result1 = await fetchTranscript('failed-video')
    expect(result1.success).toBe(false)
    expect(mockFetch).toHaveBeenCalledTimes(2) // Both clients tried

    const result2 = await fetchTranscript('failed-video')
    expect(result2.success).toBe(false)
    expect(result2.fromCache).toBe(true)
    expect(mockFetch).toHaveBeenCalledTimes(2) // Not called again
  })

  it('cache expires after TTL', async () => {
    mockInnerTubeSuccess([{ text: 'First fetch', start: 0, dur: 1 }])

    await fetchTranscript('expire-video')
    expect(mockFetch).toHaveBeenCalledTimes(2)

    // Before expiry
    vi.advanceTimersByTime(4 * 60 * 1000)
    await fetchTranscript('expire-video')
    expect(mockFetch).toHaveBeenCalledTimes(2)

    // After expiry
    vi.advanceTimersByTime(2 * 60 * 1000)
    mockInnerTubeSuccess([{ text: 'Second fetch', start: 0, dur: 1 }])
    const result = await fetchTranscript('expire-video')
    expect(mockFetch).toHaveBeenCalledTimes(4)
    expect(result.transcript).toContain('Second fetch')
  })

  it('trims whitespace from text segments', async () => {
    mockInnerTubeSuccess([
      { text: '  Hello world  ', start: 0, dur: 1 },
      { text: '\n\nTest\n\n', start: 1, dur: 1 },
    ])

    const result = await fetchTranscript('whitespace-video')

    expect(result.success).toBe(true)
    expect(result.segments[0]?.text).toBe('Hello world')
    expect(result.segments[1]?.text).toBe('Test')
  })
})

describe('clearTranscriptCache', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('clears cache for specific video', async () => {
    mockInnerTubeSuccess([{ text: 'Original', start: 0, dur: 1 }])

    await fetchTranscript('clear-test-video')
    expect(mockFetch).toHaveBeenCalledTimes(2)

    // Verify cached
    await fetchTranscript('clear-test-video')
    expect(mockFetch).toHaveBeenCalledTimes(2)

    // Clear cache
    clearTranscriptCache('clear-test-video')

    // Next fetch should call API again
    mockInnerTubeSuccess([{ text: 'After clear', start: 0, dur: 1 }])
    const result = await fetchTranscript('clear-test-video')
    expect(mockFetch).toHaveBeenCalledTimes(4)
    expect(result.transcript).toContain('After clear')
  })

  it('only clears specified video cache', async () => {
    mockInnerTubeSuccess([{ text: 'Video 1', start: 0, dur: 1 }])
    mockInnerTubeSuccess([{ text: 'Video 2', start: 0, dur: 1 }])

    await fetchTranscript('video1')
    await fetchTranscript('video2')
    expect(mockFetch).toHaveBeenCalledTimes(4)

    clearTranscriptCache('video1')

    // video2 still cached
    await fetchTranscript('video2')
    expect(mockFetch).toHaveBeenCalledTimes(4)

    // video1 re-fetches
    mockInnerTubeSuccess([{ text: 'Video 1 new', start: 0, dur: 1 }])
    await fetchTranscript('video1')
    expect(mockFetch).toHaveBeenCalledTimes(6)
  })
})
