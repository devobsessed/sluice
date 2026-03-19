import { fetchAndStoreTranscript } from '@/lib/automation/processor'
import { generateEmbeddingsStep, generateInsightsStep } from './steps'

/**
 * Durable step that fetches a YouTube transcript and stores it on the video record.
 * Wraps fetchAndStoreTranscript() - the same logic used by the job processor.
 *
 * Default WDK retry: 3 attempts on unhandled errors.
 */
async function fetchTranscriptStep(videoId: number, youtubeId: string): Promise<void> {
  'use step'
  await fetchAndStoreTranscript(videoId, youtubeId)
}

/**
 * RSS feed discovery workflow. Triggered by check-feeds cron when a new video
 * is discovered via RSS. Replaces the fetch_transcript -> generate_embeddings
 * job chain with three durable steps in one workflow.
 *
 * Step 1: Fetch transcript from YouTube and store on video record
 * Step 2: Generate embeddings from the stored transcript
 * Step 3: Generate AI insights from the stored transcript
 *
 * If step 1 fails (e.g., transcript unavailable), steps 2 and 3 never run.
 * If step 2 fails, step 3 never runs.
 * WDK provides automatic retry (3 attempts) per step.
 */
export async function rssFeedWorkflow(videoId: number, youtubeId: string): Promise<void> {
  'use workflow'

  await fetchTranscriptStep(videoId, youtubeId)
  await generateEmbeddingsStep(videoId)
  await generateInsightsStep(videoId)
}
