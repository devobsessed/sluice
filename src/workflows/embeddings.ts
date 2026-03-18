import { processGenerateEmbeddings, processGenerateInsights } from '@/lib/automation/processor'

/**
 * Durable step that generates embeddings for a video's transcript.
 * Wraps the existing processGenerateEmbeddings() - single source of truth
 * for the parse -> chunk -> embed -> store pipeline.
 *
 * Default WDK retry: 3 attempts on unhandled errors.
 */
async function generateEmbeddingsStep(videoId: number): Promise<void> {
  'use step'
  await processGenerateEmbeddings({ videoId })
}

/**
 * Durable step that generates AI insights for a video.
 * Wraps processGenerateInsights() - idempotent; safe to retry.
 *
 * Default WDK retry: 3 attempts on unhandled errors.
 */
async function generateInsightsStep(videoId: number): Promise<void> {
  'use step'
  await processGenerateInsights({ videoId })
}

/**
 * Embeddings workflow triggered when a video is added on Vercel.
 * Two-step pipeline:
 *   Step 1: Generate embeddings from the stored transcript
 *   Step 2: Generate AI insights from the stored transcript
 *
 * If step 1 fails, step 2 never runs.
 */
export async function embeddingsWorkflow(videoId: number): Promise<void> {
  'use workflow'
  await generateEmbeddingsStep(videoId)
  await generateInsightsStep(videoId)
}
