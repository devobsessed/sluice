import { db } from '@/lib/db'
import { videos, chunks } from '@/lib/db/schema'
import { eq, count } from 'drizzle-orm'
import { fetchTranscript } from '@/lib/youtube/transcript'
import { parseTranscript } from '@/lib/transcript/parse'
import { chunkTranscript } from '@/lib/embeddings/chunker'
// Dynamic import used at call site to avoid ONNX native library crash on module load
import { generateText } from '@/lib/claude/client'
import { buildExtractionPrompt } from '@/lib/claude/prompts/extract'
import { parsePartialJSON } from '@/lib/claude/prompts/parser'
import { getExtractionForVideo, upsertExtraction } from '@/lib/db/insights'
import type { TranscriptSegment } from '@/lib/embeddings/types'
import type { ExtractionResult } from '@/lib/claude/prompts/types'

function getVideoId(payload: unknown, jobName: string): number {
  if (payload == null || typeof payload !== 'object') {
    throw new Error(`Invalid ${jobName} job payload`)
  }
  const videoId = (payload as Record<string, unknown>).videoId
  if (typeof videoId !== 'number') {
    throw new Error(`Invalid ${jobName} job payload`)
  }
  return videoId
}

/**
 * Core transcript fetch + store logic. Fetches a YouTube transcript
 * and stores it on the video record. Used by the RSS feed workflow step.
 */
export async function fetchAndStoreTranscript(videoId: number, youtubeId: string): Promise<void> {
  const result = await fetchTranscript(youtubeId)

  if (!result.success || !result.transcript) {
    throw new Error(`Transcript fetch failed: ${result.error || 'No transcript available'}`)
  }

  await db.update(videos)
    .set({
      transcript: result.transcript,
      updatedAt: new Date(),
    })
    .where(eq(videos.id, videoId))
}

export async function processGenerateEmbeddings(payload: unknown): Promise<void> {
  const videoId = getVideoId(payload, 'embeddings')

  // Get the video to check it has a transcript
  const result = await db.select().from(videos).where(eq(videos.id, videoId)).limit(1)
  const video = result[0]

  if (!video || !video.transcript) {
    throw new Error(`Video ${videoId} not found or has no transcript`)
  }

  // Parse transcript and chunk it
  const parsedSegments = parseTranscript(video.transcript)
  const segments: TranscriptSegment[] = parsedSegments.map(seg => ({
    text: seg.text,
    offset: seg.seconds * 1000, // Convert seconds to milliseconds
  }))
  const chunkedSegments = chunkTranscript(segments)

  if (chunkedSegments.length === 0) {
    throw new Error('No chunks generated from transcript')
  }

  // Partial progress check: if chunks already exist for this video matching
  // the expected count, skip re-embedding. storeChunksToDatabase uses an atomic
  // DELETE+INSERT transaction, so partial state is impossible -- either all
  // chunks exist (previous run succeeded) or none do (previous run failed).
  const [existingChunkCount] = await db
    .select({ value: count() })
    .from(chunks)
    .where(eq(chunks.videoId, videoId))

  if (existingChunkCount && Number(existingChunkCount.value) >= chunkedSegments.length) {
    console.log(`[embedding-job] Video ${videoId} already has ${existingChunkCount.value} chunks (expected ${chunkedSegments.length}), skipping re-embed`)
    return
  }

  // Dynamic import to avoid ONNX native library crash on module load
  const { embedChunks } = await import('@/lib/embeddings/service')
  await embedChunks(chunkedSegments, undefined, videoId)
}

export async function processGenerateInsights(payload: unknown): Promise<void> {
  const videoId = getVideoId(payload, 'insights')

  // Idempotency: skip if insights already exist.
  // Note: this is a check-then-act pattern with a theoretical TOCTOU race -
  // two concurrent workers could both see null and proceed. This is benign:
  // upsertExtraction() uses ON CONFLICT DO UPDATE on the unique videoId
  // constraint, so last-write-wins with no data loss. The only cost is a
  // redundant Claude API call, which is acceptable given workflows run
  // single-instance per video.
  const existing = await getExtractionForVideo(videoId)
  if (existing) {
    console.log(`[insights-job] Video ${videoId} already has insights, skipping`)
    return
  }

  // Get the video to build the extraction prompt
  const result = await db.select().from(videos).where(eq(videos.id, videoId)).limit(1)
  const video = result[0]

  if (!video) {
    throw new Error(`Video ${videoId} not found`)
  }

  if (!video.transcript) {
    throw new Error(`Video ${videoId} has no transcript`)
  }

  // Build prompt and call Claude API (non-streaming)
  const prompt = buildExtractionPrompt({
    title: video.title,
    channel: video.channel ?? '',
    transcript: video.transcript,
  })

  const rawResponse = await generateText(prompt)

  if (!rawResponse || rawResponse.trim() === '') {
    throw new Error(`Claude returned empty response for video ${videoId}`)
  }

  // Parse the JSON response
  const parsed = parsePartialJSON(rawResponse)

  if (!parsed) {
    throw new Error(`Failed to parse extraction response for video ${videoId}`)
  }

  // Validate minimum required sections before persisting
  if (!parsed.contentType || !parsed.summary || !parsed.insights || !parsed.actionItems) {
    throw new Error(`Incomplete extraction for video ${videoId}: missing required sections`)
  }

  // Fill in claudeCode default if missing (same logic as ExtractionProvider's isCompleteExtraction)
  if (!parsed.claudeCode) {
    parsed.claudeCode = {
      applicable: false,
      skills: [],
      commands: [],
      agents: [],
      hooks: [],
      rules: [],
    }
  }

  // Persist to database
  await upsertExtraction(videoId, parsed as ExtractionResult)
  console.log(`[insights-job] Generated insights for video ${videoId} (type: ${parsed.contentType})`)
}
