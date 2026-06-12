import { eq, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { db as database, videos, chunks, personas } from '@/lib/db'
import type * as schema from '@/lib/db/schema'
import type { Persona } from '@/lib/db/schema'
import { computeChannelCentroid } from '@/lib/channels/similarity'
import { generateText } from '@/lib/claude/client'

/** Minimum video count before suggesting a persona for a channel */
export const PERSONA_THRESHOLD = 5

/** Maximum number of transcript videos to sample for persona generation */
const PERSONA_TRANSCRIPT_SAMPLE_LIMIT = 20

/** Maximum combined transcript character length to send to Claude */
const PERSONA_TRANSCRIPT_CHAR_LIMIT = 30000

/**
 * Generates a persona system prompt by analyzing the creator's content.
 *
 * Samples transcripts from the channel's videos and uses Claude to analyze
 * writing style, expertise, and tone to generate a persona description.
 *
 * @param channelName - Name of the channel
 * @param db - Database instance (defaults to singleton)
 * @returns Generated system prompt
 * @throws Error if no transcripts found or API fails
 */
export async function generatePersonaSystemPrompt(
  channelName: string,
  db: NodePgDatabase<typeof schema> = database
): Promise<string> {
  // Fetch sample transcripts - up to 20 videos for richer persona analysis
  const transcriptSamples = await db
    .select({
      transcript: videos.transcript,
    })
    .from(videos)
    .where(
      sql`${videos.channel} = ${channelName} AND ${videos.transcript} IS NOT NULL`
    )
    .limit(PERSONA_TRANSCRIPT_SAMPLE_LIMIT)

  if (transcriptSamples.length === 0) {
    throw new Error('No transcripts found for channel')
  }

  // Combine samples for analysis, capped at ~30k chars to fit context window
  const combinedTranscripts = transcriptSamples
    .map((s) => s.transcript)
    .filter(Boolean)
    .join('\n\n---\n\n')
    .slice(0, PERSONA_TRANSCRIPT_CHAR_LIMIT)

  // Build v2 prompt: request a rich persona document with real opinions and voice
  const analysisPrompt = `Analyze the following video transcripts from the YouTube creator "${channelName}" and write a persona document that will guide an AI to speak authentically as this creator.

Transcripts:
${combinedTranscripts}

Write a plain-prose persona document covering ALL of the following:

1. Voice and tone: How do they sound? What makes their delivery distinctive?
2. Recurring opinions and takes: What positions do they hold consistently? What are their signature beliefs about their field?
3. Pet peeves: What mistakes, habits, or misconceptions do they call out repeatedly?
4. How they handle basic questions: Do they give direct answers, reframe the question, add nuance, or redirect to fundamentals?
5. Questioning style (Socratic vs lecture): Do they tend to ask questions back to make the viewer think, or do they explain and teach directly?

Write in second person ("You are..."). Be specific and concrete - use phrases and stances that actually appear in the content above. Avoid generic filler.`

  try {
    const generatedPrompt = await generateText(analysisPrompt)

    if (!generatedPrompt) {
      throw new Error('Failed to generate system prompt from Claude API')
    }

    return generatedPrompt.trim()
  } catch (error) {
    if (error instanceof Error) {
      throw error
    }
    throw new Error('Unknown error during system prompt generation')
  }
}

/**
 * Regenerates the v2 persona system prompt for an existing persona and
 * updates the row in place.
 *
 * Preserves `id`, `expertiseEmbedding`, `expertiseTopics`, and `transcriptCount`
 * so localStorage chat history (keyed by personaId) remains valid.
 *
 * @param channelName - Name of the channel whose persona to update
 * @param db - Database instance (defaults to singleton)
 * @returns The updated persona row
 * @throws Error if the channel has no transcripts or no existing persona row
 */
export async function regeneratePersonaSystemPrompt(
  channelName: string,
  db: NodePgDatabase<typeof schema> = database
): Promise<Persona> {
  // Confirm the persona row exists BEFORE paying for generation (transcript
  // query + Claude call) - and so a missing row fails with the documented
  // 'No persona found' error instead of 'No transcripts found'.
  const [existing] = await db
    .select()
    .from(personas)
    .where(eq(personas.channelName, channelName))
    .limit(1)

  if (!existing) {
    throw new Error(`No persona found for channel "${channelName}"`)
  }

  // Regenerate the system prompt using the v2 builder
  const systemPrompt = await generatePersonaSystemPrompt(channelName, db)

  // UPDATE in place - never insert; preserves id so localStorage history stays attached
  const [updated] = await db
    .update(personas)
    .set({ systemPrompt })
    .where(eq(personas.channelName, channelName))
    .returning()

  if (!updated) {
    throw new Error(`No persona found for channel "${channelName}"`)
  }

  return updated
}

/**
 * Extracts top expertise topics from channel chunks.
 *
 * Analyzes chunk content to identify the most common topics and themes
 * discussed by the creator.
 *
 * @param channelName - Name of the channel
 * @param db - Database instance (defaults to singleton)
 * @returns Array of topic strings (max 10)
 */
export async function extractExpertiseTopics(
  channelName: string,
  db: NodePgDatabase<typeof schema> = database
): Promise<string[]> {
  // Fetch chunk content for this channel
  const channelChunks = await db
    .select({
      content: chunks.content,
    })
    .from(chunks)
    .innerJoin(videos, eq(chunks.videoId, videos.id))
    .where(sql`${videos.channel} = ${channelName}`)

  if (channelChunks.length === 0) {
    return []
  }

  // Simple topic extraction: find most common meaningful words
  // This is a basic implementation - could be enhanced with NLP
  const wordFrequency = new Map<string, number>()
  const stopWords = new Set([
    'the',
    'a',
    'an',
    'and',
    'or',
    'but',
    'in',
    'on',
    'at',
    'to',
    'for',
    'of',
    'with',
    'by',
    'from',
    'as',
    'is',
    'was',
    'are',
    'be',
    'this',
    'that',
    'it',
    'you',
    'we',
    'they',
    'can',
    'will',
    'have',
    'has',
    'had',
    'do',
    'does',
    'did',
  ])

  for (const chunk of channelChunks) {
    const words = chunk.content
      .toLowerCase()
      .match(/\b[a-z]{3,}\b/g) || []

    for (const word of words) {
      if (!stopWords.has(word)) {
        wordFrequency.set(word, (wordFrequency.get(word) || 0) + 1)
      }
    }
  }

  // Sort by frequency and take top 10
  const topics = Array.from(wordFrequency.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word]) => word)

  return topics
}

/**
 * Computes expertise embedding from top representative chunks.
 *
 * Uses the channel centroid (average of all chunk embeddings) as the
 * expertise embedding for semantic routing.
 *
 * @param channelName - Name of the channel
 * @param db - Database instance (defaults to singleton)
 * @returns 384-dimensional embedding vector, or null if no embeddings found
 */
export async function computeExpertiseEmbedding(
  channelName: string,
  db: NodePgDatabase<typeof schema> = database
): Promise<number[] | null> {
  // Reuse the existing computeChannelCentroid function
  return computeChannelCentroid(channelName, db)
}

/**
 * Creates a persona from a YouTube channel.
 *
 * Orchestrates the full persona creation flow:
 * 1. Count videos/transcripts
 * 2. Generate system prompt via Claude
 * 3. Extract expertise topics
 * 4. Compute expertise embedding
 * 5. Insert into database
 *
 * @param channelName - Name of the channel
 * @param db - Database instance (defaults to singleton)
 * @returns Created persona
 * @throws Error if channel has no videos or creation fails
 */
export async function createPersona(
  channelName: string,
  db: NodePgDatabase<typeof schema> = database
): Promise<Persona> {
  // Count videos for this channel
  const videoRecords = await db
    .select({
      id: videos.id,
    })
    .from(videos)
    .where(eq(videos.channel, channelName))

  const transcriptCount = videoRecords.length

  if (transcriptCount === 0) {
    throw new Error('No videos found for channel')
  }

  // Generate system prompt
  const systemPrompt = await generatePersonaSystemPrompt(channelName, db)

  // Extract expertise topics
  const expertiseTopics = await extractExpertiseTopics(channelName, db)

  // Compute expertise embedding
  const expertiseEmbedding = await computeExpertiseEmbedding(channelName, db)

  // Insert persona into database
  const [persona] = await db
    .insert(personas)
    .values({
      channelName,
      name: channelName, // Use channel name as display name by default
      systemPrompt,
      expertiseTopics,
      expertiseEmbedding,
      transcriptCount,
    })
    .returning()

  if (!persona) {
    throw new Error('Failed to insert persona into database')
  }

  return persona
}
