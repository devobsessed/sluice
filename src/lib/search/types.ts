/**
 * Result from vector search containing chunk data and video metadata
 */
export interface SearchResult {
  // Chunk data
  chunkId: number;
  content: string;
  startTime: number | null;
  endTime: number | null;
  similarity: number; // 0-1 range, higher is more similar
  // Raw cosine similarity from the vector leg, preserved through RRF fusion.
  // After hybrid fusion `similarity` holds the RRF rank score (~0.016-0.03),
  // which is meaningless as an evidence signal — consumers that need "how
  // relevant is this actually" (e.g. the persona weak-retrieval guard) must
  // read vectorSimilarity. Undefined for keyword-only results (no cosine).
  vectorSimilarity?: number;

  // Video metadata
  videoId: number;
  videoTitle: string;
  channel: string | null;
  youtubeId: string | null;
  thumbnail: string | null;
  publishedAt?: Date | null; // For temporal decay calculations
}
