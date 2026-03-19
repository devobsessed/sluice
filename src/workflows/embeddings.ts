import { generateEmbeddingsStep, generateInsightsStep } from './steps'

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
