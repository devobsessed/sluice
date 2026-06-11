import { and, desc, sql, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { db as defaultDb, chunks, videos } from '@/lib/db';
import type * as schema from '@/lib/db/schema';
import type { SearchResult } from './types';
// Dynamic import used at call sites to avoid ONNX native library crash on module load

/**
 * Performs vector similarity search on chunk embeddings.
 *
 * Uses cosine distance to find chunks most similar to the query embedding.
 * Cosine distance ranges from 0 (identical) to 2 (opposite).
 * We convert this to a similarity score: 1 - (distance / 2), giving a 0-1 range.
 *
 * @param queryEmbedding - The embedding vector to search for (384 dimensions)
 * @param limit - Maximum number of results to return (default: 10)
 * @param threshold - Minimum similarity score (0-1) to include in results (default: 0.3)
 * @param db - Database instance (optional, defaults to singleton)
 * @param channel - Optional exact-match channel name filter. When provided, restricts
 *   results to chunks whose video.channel matches exactly. When omitted or null/empty,
 *   behavior is identical to today's global search.
 * @returns Array of search results ordered by similarity (highest first)
 */
export async function vectorSearch(
  queryEmbedding: number[],
  limit = 10,
  threshold = 0.3,
  db: NodePgDatabase<typeof schema> = defaultDb,
  channel?: string | null,
): Promise<SearchResult[]> {
  // Validate input
  if (!Array.isArray(queryEmbedding) || queryEmbedding.length !== 384) {
    throw new TypeError(
      `Expected queryEmbedding to be an array of 384 numbers, got ${typeof queryEmbedding} with length ${Array.isArray(queryEmbedding) ? queryEmbedding.length : 'N/A'}`
    );
  }

  // Format embedding as PostgreSQL vector string: '[0.1, 0.2, ...]'
  const vectorString = `[${queryEmbedding.join(',')}]`;

  // Cosine distance: 0 = identical, 2 = opposite
  // Convert to similarity: 1 - (distance / 2) gives 0-1 range
  const similarity = sql<number>`1 - ((${chunks.embedding} <=> ${vectorString}::vector) / 2)`;

  const embeddingGuard = sql`${chunks.embedding} IS NOT NULL`
  const whereCondition = channel
    ? and(embeddingGuard, eq(videos.channel, channel))
    : embeddingGuard

  const results = await db
    .select({
      chunkId: chunks.id,
      content: chunks.content,
      startTime: chunks.startTime,
      endTime: chunks.endTime,
      similarity,
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
    .orderBy(desc(similarity))
    .limit(limit);

  // Filter by threshold after query (Drizzle doesn't support WHERE on computed columns)
  return results.filter(r => r.similarity >= threshold);
}

/**
 * Convenience function that combines embedding generation and vector search.
 * Takes a text query, generates its embedding, and searches for similar chunks.
 *
 * @param query - Text query to search for
 * @param limit - Maximum number of results to return (default: 10)
 * @param threshold - Minimum similarity score (0-1) to include in results (default: 0.3)
 * @param db - Database instance (optional, defaults to singleton)
 * @returns Array of search results ordered by similarity (highest first)
 * @throws TypeError if query is not a non-empty string
 */
export async function searchByQuery(
  query: string,
  limit = 10,
  threshold = 0.3,
  db: NodePgDatabase<typeof schema> = defaultDb
): Promise<SearchResult[]> {
  // Validate input
  if (typeof query !== 'string' || query.trim().length === 0) {
    throw new TypeError(
      `Expected query to be a non-empty string, got ${typeof query}`
    );
  }

  // Generate embedding for the query
  const { generateEmbedding } = await import('@/lib/embeddings/pipeline')
  const embedding = await generateEmbedding(query);

  // Convert Float32Array to regular array for database query
  const embeddingArray = Array.from(embedding);

  // Perform vector search
  return vectorSearch(embeddingArray, limit, threshold, db);
}
