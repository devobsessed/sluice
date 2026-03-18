import { processGenerateEmbeddings } from '@/lib/automation/processor'

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
 * Embeddings workflow triggered when a video is added on Vercel.
 * Currently has one step; story 5 (insights-workflow) will add a second
 * step chained after this one.
 */
export async function embeddingsWorkflow(videoId: number): Promise<void> {
  'use workflow'
  await generateEmbeddingsStep(videoId)
}
