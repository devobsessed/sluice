import { processGenerateEmbeddings, processGenerateInsights } from '@/lib/automation/processor'

/**
 * Durable step that generates embeddings for a video's transcript.
 * Wraps the existing processGenerateEmbeddings() - single source of truth
 * for the parse -> chunk -> embed -> store pipeline.
 *
 * Default WDK retry: 3 attempts on unhandled errors.
 */
export async function generateEmbeddingsStep(videoId: number): Promise<void> {
  'use step'
  await processGenerateEmbeddings({ videoId })
}

/**
 * Durable step that generates AI insights for a video.
 * Wraps processGenerateInsights() - idempotent; safe to retry.
 *
 * Default WDK retry: 3 attempts on unhandled errors.
 */
export async function generateInsightsStep(videoId: number): Promise<void> {
  'use step'
  await processGenerateInsights({ videoId })
}
