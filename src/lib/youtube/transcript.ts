import type { TranscriptSegment } from '@/lib/transcript/types'
import { fetchTranscriptSupadata } from './transcript-supadata'

export interface TranscriptFetchResult {
  success: boolean;
  transcript: string | null;
  segments: TranscriptSegment[];
  error?: string;
  language?: string;
  fromCache?: boolean;
}

interface CachedResult {
  data: TranscriptFetchResult;
  expiresAt: number;
}

interface RawTranscriptItem {
  text: string;
  duration: number;
  offset: number;
}

// In-memory cache to avoid re-fetching
const transcriptCache = new Map<string, CachedResult>()
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

// Two XML formats YouTube uses for transcripts
const RE_XML_STANDARD = /<text start="([^"]*)" dur="([^"]*)">([^<]*)<\/text>/g
const RE_XML_ASR = /<p t="(\d+)" d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g
const RE_XML_ASR_SEGMENT = /<s[^>]*>([^<]*)<\/s>/g

// InnerTube client configurations to try in order
const INNERTUBE_CLIENTS = [
  {
    name: 'ANDROID',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'com.google.android.youtube/21.03.36(Linux; U; Android 16; en_US; SM-S908E Build/TP1A.220624.014) gzip',
    },
    context: {
      client: {
        clientName: 'ANDROID',
        clientVersion: '21.03.36',
        androidSdkVersion: 36,
      },
    },
  },
  {
    name: 'WEB',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
      'Cookie': 'CONSENT=PENDING+987; SOCS=CAESEwgDEgk0ODE3Nzk3MjQaAmVuIAEaBgiA_LyaBg',
    },
    context: {
      client: {
        clientName: 'WEB',
        clientVersion: '2.20260206.01.00',
      },
    },
  },
] as const

/**
 * Fetch transcript via YouTube InnerTube API.
 * Tries ANDROID client first, then WEB client with consent cookie.
 * Handles both standard and ASR transcript XML formats.
 */
async function fetchTranscriptInnerTube(videoId: string, lang = 'en'): Promise<RawTranscriptItem[]> {
  let lastError: Error | null = null

  for (const client of INNERTUBE_CLIENTS) {
    try {
      const result = await tryInnerTubeClient(videoId, lang, client)
      if (result.length > 0) return result
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      console.warn(`[transcript] ${client.name} client failed for ${videoId}:`, lastError.message)
    }
  }

  throw lastError ?? new Error('All InnerTube clients failed')
}

async function tryInnerTubeClient(
  videoId: string,
  lang: string,
  client: typeof INNERTUBE_CLIENTS[number],
): Promise<RawTranscriptItem[]> {
  const playerResponse = await fetch('https://www.youtube.com/youtubei/v1/player', {
    method: 'POST',
    headers: client.headers,
    body: JSON.stringify({
      context: {
        client: {
          ...client.context.client,
          hl: lang,
          gl: 'US',
        },
      },
      videoId,
    }),
  })

  if (!playerResponse.ok) {
    throw new Error(
      `InnerTube API rejected request (${client.name}: HTTP ${playerResponse.status})`
    )
  }

  const data = await playerResponse.json()
  const playabilityStatus = data?.playabilityStatus?.status
  const captions = data?.captions?.playerCaptionsTracklistRenderer

  // Log for production debugging
  console.info(`[transcript] ${client.name} response for ${videoId}: playability=${playabilityStatus}, tracks=${captions?.captionTracks?.length ?? 0}`)

  if (!captions?.captionTracks?.length) {
    throw new Error(`No caption tracks available (${client.name}: playability=${playabilityStatus ?? 'unknown'})`)
  }

  const tracks = captions.captionTracks as Array<{
    languageCode: string;
    kind?: string;
    baseUrl: string;
  }>

  // Find best matching track
  const track =
    tracks.find((t) => t.languageCode === lang) ||
    tracks.find((t) => t.languageCode.startsWith(lang + '-')) ||
    tracks.find((t) => t.kind === 'asr') ||
    tracks[0]!

  const transcriptResponse = await fetch(track.baseUrl, {
    headers: {
      ...client.headers,
      'Accept-Language': lang,
    },
  })

  if (!transcriptResponse.ok) {
    throw new Error('Failed to fetch transcript file')
  }

  const xml = await transcriptResponse.text()

  if (!xml || xml.length === 0) {
    throw new Error('Empty transcript response')
  }

  // Try standard format first: <text start="..." dur="...">...</text>
  const standardResults = [...xml.matchAll(RE_XML_STANDARD)]
  if (standardResults.length) {
    return standardResults
      .map((result) => ({
        text: decodeHtmlEntities(result[3] ?? ''),
        duration: parseFloat(result[2] ?? '0'),
        offset: parseFloat(result[1] ?? '0'),
      }))
      .filter((item) => item.text.trim() !== '')
  }

  // Try ASR format: <p t="..." d="...">...<s>...</s>...</p>
  const asrResults = [...xml.matchAll(RE_XML_ASR)]
  if (asrResults.length) {
    return asrResults
      .map((block) => {
        let text: string
        const segments = [...(block[3] ?? '').matchAll(RE_XML_ASR_SEGMENT)]
        if (segments.length) {
          text = segments.map((s) => s[1] ?? '').join('').trim()
        } else {
          text = (block[3] ?? '').replace(/<[^>]*>/g, '').trim()
        }

        return {
          text: decodeHtmlEntities(text),
          duration: Number(block[2] ?? '0') / 1000,
          offset: Number(block[1] ?? '0') / 1000,
        }
      })
      .filter((item) => item.text.trim() !== '')
  }

  throw new Error('No transcript content found in response')
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
}

/**
 * Fetch transcript for a YouTube video.
 *
 * Uses YouTube InnerTube API (Android client) which works from
 * both local machines and datacenter IPs (Vercel, AWS, etc).
 *
 * @param videoId - YouTube video ID (not full URL)
 * @returns Transcript data or error
 */
export async function fetchTranscript(
  videoId: string
): Promise<TranscriptFetchResult> {
  // Check cache first
  const cached = transcriptCache.get(videoId)
  if (cached && cached.expiresAt > Date.now()) {
    return { ...cached.data, fromCache: true }
  }

  try {
    let items: RawTranscriptItem[]

    if (process.env.SUPADATA_API_KEY) {
      try {
        items = await fetchTranscriptSupadata(videoId, 'en')
      } catch (supadataError) {
        console.warn(`[transcript] Supadata failed for ${videoId}, falling back to InnerTube:`, supadataError instanceof Error ? supadataError.message : supadataError)
        items = await fetchTranscriptInnerTube(videoId, 'en')
      }
    } else {
      items = await fetchTranscriptInnerTube(videoId, 'en')
    }

    if (!items.length) {
      const result: TranscriptFetchResult = {
        success: false,
        transcript: null,
        segments: [],
        error: 'No transcript available for this video',
      }
      transcriptCache.set(videoId, {
        data: result,
        expiresAt: Date.now() + CACHE_TTL,
      })
      return result
    }

    // Convert to our segment format
    const segments: TranscriptSegment[] = items.map((item) => ({
      timestamp: formatTimestamp(item.offset),
      seconds: Math.floor(item.offset),
      text: item.text.trim(),
    }))

    // Build full transcript text with timestamps
    const transcript = segments
      .map((seg) => `${seg.timestamp}\n${seg.text}`)
      .join('\n\n')

    const result: TranscriptFetchResult = {
      success: true,
      transcript,
      segments,
      language: 'en',
    }

    transcriptCache.set(videoId, {
      data: result,
      expiresAt: Date.now() + CACHE_TTL,
    })

    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'

    let errorMessage = `Failed to fetch transcript: ${message}`

    if (message.includes('API rejected')) {
      errorMessage = 'YouTube API rejected the request - InnerTube client versions may be outdated'
    } else if (message.includes('No caption tracks') || message.includes('disabled')) {
      errorMessage = 'Transcripts are not available for this video'
    } else if (message.includes('private') || message.includes('unavailable')) {
      errorMessage = 'Video is private or unavailable'
    } else if (message.includes('not found') || message.includes('No transcript')) {
      errorMessage = 'No transcript available for this video'
    }

    const result: TranscriptFetchResult = {
      success: false,
      transcript: null,
      segments: [],
      error: errorMessage,
    }

    transcriptCache.set(videoId, {
      data: result,
      expiresAt: Date.now() + CACHE_TTL,
    })

    return result
  }
}

/**
 * Clear cache for a specific video (useful for retry)
 */
export function clearTranscriptCache(videoId: string): void {
  transcriptCache.delete(videoId)
}

/**
 * Format seconds to timestamp string (MM:SS or H:MM:SS)
 */
function formatTimestamp(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = Math.floor(totalSeconds % 60)

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}
