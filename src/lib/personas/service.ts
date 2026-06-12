import { eq, sql, and, or, isNull, lt } from 'drizzle-orm'
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

/** Poll interval (ms) used by waitForRegenerationToClear */
const LOCK_POLL_INTERVAL_MS = 500

/**
 * Attempts to atomically claim the regeneration lock on a persona row.
 *
 * Issues a single conditional UPDATE:
 *   SET regenerating_at = now()
 *   WHERE id = :id AND (regenerating_at IS NULL OR regenerating_at < now() - :staleAfterMs ms)
 *
 * Postgres serializes concurrent UPDATEs on the same row, so exactly one
 * caller's predicate can be satisfied - the single-winner guarantee.
 *
 * @param personaId - Primary key of the persona row
 * @param staleAfterMs - Milliseconds after which an existing lock is treated
 *   as dead and reclaimable (should match the route maxDuration budget)
 * @param db - Database instance (defaults to singleton)
 * @returns true if this caller claimed the lock, false if another holds it
 */
export async function claimRegenerationLock(
  personaId: number,
  staleAfterMs: number,
  db: NodePgDatabase<typeof schema> = database
): Promise<boolean> {
  const staleIntervalSec = staleAfterMs / 1000
  const updated = await db
    .update(personas)
    .set({ regeneratingAt: sql`now()` })
    .where(
      and(
        eq(personas.id, personaId),
        or(
          isNull(personas.regeneratingAt),
          lt(
            personas.regeneratingAt,
            sql`now() - (${staleIntervalSec} || ' seconds')::interval`
          )
        )
      )
    )
    .returning({ id: personas.id })

  return updated.length === 1
}

/**
 * Releases the regeneration lock on a persona row.
 *
 * Called in `finally` by the lock owner so the next caller can claim
 * immediately. The stale-lock predicate in claimRegenerationLock covers
 * process-death cases where finally never runs.
 *
 * @param personaId - Primary key of the persona row
 * @param db - Database instance (defaults to singleton)
 */
export async function releaseRegenerationLock(
  personaId: number,
  db: NodePgDatabase<typeof schema> = database
): Promise<void> {
  await db
    .update(personas)
    .set({ regeneratingAt: null })
    .where(eq(personas.id, personaId))
}

/**
 * Polls the persona row until regenerating_at IS NULL, then returns the
 * fresh row. Used by the lock loser (joiner) to wait for the owner to finish
 * and then return the owner's result.
 *
 * @param personaId - Primary key of the persona row
 * @param timeoutMs - Maximum time to wait before throwing
 * @param db - Database instance (defaults to singleton)
 * @returns The fresh Persona row after the lock has been released
 * @throws Error if timeoutMs is exceeded before the lock clears
 */
export async function waitForRegenerationToClear(
  personaId: number,
  timeoutMs: number,
  db: NodePgDatabase<typeof schema> = database
): Promise<Persona> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const [row] = await db
      .select()
      .from(personas)
      .where(eq(personas.id, personaId))
      .limit(1)

    if (!row) {
      throw new Error(`Persona ${personaId} not found while waiting for lock to clear`)
    }

    if (row.regeneratingAt === null) {
      return row
    }

    // Still locked - wait before polling again, but respect the deadline
    const remaining = deadline - Date.now()
    if (remaining <= 0) break
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(LOCK_POLL_INTERVAL_MS, remaining))
    )
  }

  throw new Error(
    `waitForRegenerationToClear timed out after ${timeoutMs}ms for persona ${personaId}`
  )
}

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
 * Persists systemPrompt, expertiseTopics (using the fixed extractor),
 * lastRegeneratedAt, and transcriptCount (advanced to the current channel
 * video count) in a single UPDATE. Also rebuilds expertiseEmbedding when
 * computeExpertiseEmbedding returns a non-null vector - omits the key entirely
 * when null so an existing embedding is never clobbered.
 *
 * Advancing transcriptCount clears the staleness badge: the at-generation
 * snapshot becomes the current count so the delta returns to zero.
 *
 * Preserves `id` so localStorage chat history (keyed by personaId) remains
 * valid.
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

  // Count current channel videos so the baseline advances to the real count
  // after rebuild (mirrors createPersona's pattern - select video ids by channel,
  // take .length). This clears the staleness badge: transcript_count becomes
  // the current count and the gap returns to zero.
  const currentVideoRecords = await db
    .select({ id: videos.id })
    .from(videos)
    .where(eq(videos.channel, channelName))

  const currentTranscriptCount = currentVideoRecords.length

  // Regenerate all three content fields in parallel where possible.
  // generatePersonaSystemPrompt and extractExpertiseTopics both hit the DB but
  // are independent - run concurrently to keep the Claude round-trip on the
  // critical path only.
  const [systemPrompt, expertiseTopics, expertiseEmbedding] = await Promise.all([
    generatePersonaSystemPrompt(channelName, db),
    extractExpertiseTopics(channelName, db),
    computeExpertiseEmbedding(channelName, db),
  ])

  // Build the SET payload. expertiseEmbedding is null-guarded: omit the key
  // entirely when the centroid cannot be computed so an existing (non-null)
  // embedding is never overwritten with NULL. transcriptCount advances to the
  // current channel count so the staleness badge clears after a rebuild.
  const setPayload: {
    systemPrompt: string
    expertiseTopics: string[]
    lastRegeneratedAt: Date
    transcriptCount: number
    expertiseEmbedding?: number[]
  } = {
    systemPrompt,
    expertiseTopics,
    lastRegeneratedAt: new Date(),
    transcriptCount: currentTranscriptCount,
  }

  if (expertiseEmbedding !== null) {
    setPayload.expertiseEmbedding = expertiseEmbedding
  }

  // UPDATE in place - never insert; preserves id so localStorage history stays attached
  const [updated] = await db
    .update(personas)
    .set(setPayload)
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

  // Topic extraction: find most common meaningful words
  // Expanded stopword set covers the walk-003 class (possessives, pronouns,
  // common adverbs, filler verbs) that passed the narrow original set.
  const wordFrequency = new Map<string, number>()
  const stopWords = new Set([
    // Articles / conjunctions / prepositions
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'into', 'out', 'about', 'over',
    'after', 'before', 'between', 'through', 'during', 'without', 'within',
    // Pronouns / possessives (walk-003: "your")
    'you', 'your', 'yours', 'we', 'our', 'ours', 'they', 'their', 'theirs',
    'it', 'its', 'he', 'she', 'his', 'her', 'hers', 'who', 'whom',
    // Question words / common adverbs (walk-003: "what", "now")
    'what', 'when', 'where', 'which', 'how', 'why', 'not', 'now', 'then',
    'here', 'there', 'very', 'just', 'also', 'only', 'even', 'still',
    'really', 'actually', 'basically', 'literally', 'exactly', 'already',
    'quite', 'maybe', 'always', 'never', 'often', 'again', 'ever',
    // Common filler verbs / modals (walk-003: "going", "want", "know", "think")
    'is', 'was', 'are', 'be', 'been', 'being', 'have', 'has', 'had',
    'do', 'does', 'did', 'can', 'will', 'would', 'could', 'should', 'may',
    'might', 'must', 'shall', 'get', 'got', 'say', 'said', 'see', 'saw',
    'come', 'came', 'make', 'made', 'take', 'took', 'give', 'gave',
    'going', 'want', 'know', 'think', 'need', 'look', 'feel', 'seem',
    'like', 'let', 'put', 'use', 'try', 'ask', 'keep', 'start', 'work', 'mean',
    // Common nouns that are too generic to be topics (walk-003: "people", "thing")
    'this', 'that', 'these', 'those', 'some', 'any', 'all', 'each',
    'every', 'both', 'few', 'more', 'most', 'other', 'another', 'such',
    'same', 'way', 'time', 'year', 'day', 'man', 'men', 'one', 'two',
    'three', 'people', 'person', 'thing', 'things', 'lot', 'bit', 'part',
    'case', 'kind', 'sort', 'type', 'much', 'many', 'well', 'right',
    'left', 'new', 'old', 'big', 'good', 'bad', 'able', 'sure', 'long',
    // Spoken-transcript fillers (live rebuild surfaced "because/yeah/okay")
    'because', 'yeah', 'okay', 'yes', 'stuff', 'something', 'everything',
    'anything', 'someone', 'everyone', 'somebody', 'anybody', 'nobody',
    'gonna', 'wanna', 'gotta',
    // Function words surfaced by real-data dry run ("them" ranked #1 for a channel)
    'them', 'than', 'too', 'down', 'called', 'different', 'better', 'worse',
    'were', 'doing', 'done', 'little', 'back', 'around', 'away', 'else',
    // Contraction stems - backstop for apostrophe variants the regex splits
    'don', 'didn', 'doesn', 'isn', 'wasn', 'weren', 'aren', 'haven',
    'hasn', 'hadn', 'wouldn', 'couldn', 'shouldn',
  ])

  for (const chunk of channelChunks) {
    const words = chunk.content
      .toLowerCase()
      // Drop negation contractions wholesale ("don't" must not shed "don")
      .replace(/\b[a-z]+n['’]t\b/g, ' ')
      // Strip clitic suffixes so legitimate stems survive ("creator's" -> "creator")
      .replace(/['’](s|re|ve|ll|d|m)\b/g, '')
      .match(/\b[a-z]{3,}\b/g) ?? []

    for (const word of words) {
      if (!stopWords.has(word)) {
        wordFrequency.set(word, (wordFrequency.get(word) || 0) + 1)
      }
    }
  }

  // Sort by frequency, apply minimum-frequency floor (> 1) to drop singletons,
  // then take top 10
  const topics = Array.from(wordFrequency.entries())
    .filter(([, freq]) => freq > 1)
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
