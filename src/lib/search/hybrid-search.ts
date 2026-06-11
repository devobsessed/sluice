import { and, ilike, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { db as defaultDb, chunks, videos } from '@/lib/db';
import type * as schema from '@/lib/db/schema';
import type { SearchResult } from './types';
import { vectorSearch } from './vector-search';
// Dynamic import used at call sites to avoid ONNX native library crash on module load
import { calculateTemporalDecay } from '@/lib/temporal/decay';

/**
 * Attempts to generate an embedding, retrying once on failure.
 * The first failure triggers the EmbeddingPipeline's internal cache cleanup.
 * The second attempt gets a clean cache and typically succeeds.
 *
 * @param text - Text to embed
 * @returns The embedding on success, or null if both attempts fail
 */
async function generateEmbeddingWithRetry(text: string): Promise<Float32Array | null> {
  const { generateEmbedding } = await import('@/lib/embeddings/pipeline')
  try {
    return await generateEmbedding(text)
  } catch (firstError) {
    console.warn('Embedding generation failed, retrying after cache cleanup:', firstError)
    try {
      return await generateEmbedding(text)
    } catch (retryError) {
      console.warn('Embedding retry also failed, degrading gracefully:', retryError)
      return null
    }
  }
}

/**
 * Performs keyword search on chunk content using case-insensitive LIKE matching.
 *
 * @param query - Text query to search for
 * @param limit - Maximum number of results to return (default: 20)
 * @param db - Database instance (optional, defaults to singleton)
 * @param channel - Optional exact-match channel name filter. When provided, restricts
 *   results to chunks whose video.channel matches exactly. When omitted or null/empty,
 *   behavior is identical to today's global search.
 * @returns Array of search results with similarity score of 1.0
 */
async function keywordSearch(
  query: string,
  limit = 20,
  db: NodePgDatabase<typeof schema> = defaultDb,
  channel?: string | null,
): Promise<SearchResult[]> {
  const pattern = `%${query}%`;
  const whereCondition = channel
    ? and(ilike(chunks.content, pattern), eq(videos.channel, channel))
    : ilike(chunks.content, pattern);

  const results = await db
    .select({
      chunkId: chunks.id,
      content: chunks.content,
      startTime: chunks.startTime,
      endTime: chunks.endTime,
      similarity: sql<number>`1.0`, // Keyword matches get score 1.0
      videoId: videos.id,
      videoTitle: videos.title,
      channel: videos.channel,
      youtubeId: videos.youtubeId,
      thumbnail: videos.thumbnail,
      publishedAt: videos.publishedAt,
    })
    .from(chunks)
    .innerJoin(videos, eq(chunks.videoId, videos.id))
    .where(whereCondition)
    .limit(limit);

  // Ensure similarity is a number (SQL literal returns string)
  return results.map(r => ({
    ...r,
    similarity: typeof r.similarity === 'string' ? parseFloat(r.similarity) : r.similarity,
  }));
}

/**
 * Combines vector and keyword search results using Reciprocal Rank Fusion (RRF).
 *
 * RRF gives each result a score based on its rank in each result list:
 * score = sum(1 / (k + rank)) for each list the result appears in
 *
 * This naturally boosts results that appear in multiple lists while being
 * robust to differences in score distributions between methods.
 *
 * @param vectorResults - Results from vector similarity search
 * @param keywordResults - Results from keyword search
 * @param k - RRF constant (default: 60, recommended range 10-100)
 * @returns Merged and deduplicated results ordered by RRF score
 */
function reciprocalRankFusion(
  vectorResults: SearchResult[],
  keywordResults: SearchResult[],
  k = 60
): SearchResult[] {
  const scores = new Map<number, { result: SearchResult; score: number }>();

  // Score from vector results
  vectorResults.forEach((result, rank) => {
    const existing = scores.get(result.chunkId);
    const rrfScore = 1 / (k + rank + 1);
    if (existing) {
      existing.score += rrfScore;
    } else {
      scores.set(result.chunkId, { result, score: rrfScore });
    }
  });

  // Score from keyword results
  keywordResults.forEach((result, rank) => {
    const existing = scores.get(result.chunkId);
    const rrfScore = 1 / (k + rank + 1);
    if (existing) {
      existing.score += rrfScore;
    } else {
      scores.set(result.chunkId, { result, score: rrfScore });
    }
  });

  // Sort by combined score and update similarity to RRF score
  return Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .map(({ result, score }) => ({ ...result, similarity: score }));
}

/**
 * Applies temporal decay to search results based on video publication date.
 *
 * @param results - Search results to apply decay to
 * @param halfLifeDays - Number of days for content to reach 50% relevance
 * @returns Results with adjusted similarity scores, re-sorted by new scores
 */
function applyTemporalDecay(
  results: SearchResult[],
  halfLifeDays: number = 365
): SearchResult[] {
  return results
    .map(result => {
      const decay = calculateTemporalDecay(result.publishedAt, halfLifeDays);
      return {
        ...result,
        similarity: result.similarity * decay,
      };
    })
    .sort((a, b) => b.similarity - a.similarity);
}

/**
 * Performs hybrid search combining vector similarity and keyword matching.
 *
 * Supports three modes:
 * - 'vector': Pure vector similarity search
 * - 'keyword': Pure keyword matching
 * - 'hybrid': Combines both using Reciprocal Rank Fusion (default)
 *
 * Hybrid mode fetches more results (limit * 2) before
 * merging with RRF to ensure diverse results in the final set.
 *
 * Optionally applies temporal decay to boost recent content.
 *
 * When embedding generation fails (e.g. corrupt ONNX cache on Vercel cold start),
 * vector and hybrid modes retry once. On double failure, they fall back to
 * keyword-only results and return `degraded: true` so callers can signal the user.
 *
 * @param query - Text query to search for
 * @param options - Search options (mode, limit, temporalDecay, halfLifeDays)
 * @param db - Database instance (optional, defaults to singleton)
 * @returns Object with results array and degraded flag
 */
export async function hybridSearch(
  query: string,
  options: {
    mode?: 'vector' | 'keyword' | 'hybrid';
    limit?: number;
    temporalDecay?: boolean;
    halfLifeDays?: number;
    channel?: string;
  } = {},
  db: NodePgDatabase<typeof schema> = defaultDb
): Promise<{ results: SearchResult[]; degraded: boolean }> {
  const {
    mode = 'hybrid',
    limit = 10,
    temporalDecay = false,
    halfLifeDays = 365,
    channel,
  } = options;

  let results: SearchResult[];
  let degraded = false;

  // Pure keyword mode — no embedding needed
  if (mode === 'keyword') {
    results = await keywordSearch(query, limit, db, channel);
  }
  // Pure vector mode
  else if (mode === 'vector') {
    const embedding = await generateEmbeddingWithRetry(query)
    if (embedding) {
      const embeddingArray = Array.from(embedding)
      results = await vectorSearch(embeddingArray, limit, 0.3, db, channel)
    } else {
      // Embedding failed — fall back to keyword search
      results = await keywordSearch(query, limit, db, channel)
      degraded = true
    }
  }
  // Hybrid mode: combine both with RRF
  else {
    const embedding = await generateEmbeddingWithRetry(query)
    if (embedding) {
      const embeddingArray = Array.from(embedding)
      // Fetch more results (limit * 2) from each method for better fusion
      const [vectorResults, keywordResults] = await Promise.all([
        vectorSearch(embeddingArray, limit * 2, 0.3, db, channel),
        keywordSearch(query, limit * 2, db, channel),
      ])
      // Apply RRF and take top results
      results = reciprocalRankFusion(vectorResults, keywordResults).slice(0, limit)
    } else {
      // Embedding failed — fall back to keyword-only
      results = await keywordSearch(query, limit, db, channel)
      degraded = true
    }
  }

  // Apply temporal decay if requested
  if (temporalDecay) {
    results = applyTemporalDecay(results, halfLifeDays);
  }

  return { results, degraded };
}
