import { NextResponse } from 'next/server';
import { db, videos } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { parseTranscript } from '@/lib/transcript/parse';
import { chunkTranscript } from '@/lib/embeddings/chunker';
import type { TranscriptSegment } from '@/lib/embeddings/types';
import { startApiTimer } from '@/lib/api-timing';
import { requireSession } from '@/lib/auth-guards';

interface EmbedResponse {
  success: boolean;
  alreadyEmbedded?: boolean;
  chunkCount: number;
  durationMs?: number;
  relationshipsCreated?: number;
  error?: string;
}

interface RouteContext {
  params: Promise<{
    id: string;
  }>;
}

/**
 * POST /api/videos/[id]/embed
 * Generate embeddings for a video transcript
 */
export async function POST(
  request: Request,
  context: RouteContext
): Promise<NextResponse<EmbedResponse>> {
  const denied = await requireSession()
  if (denied) return denied as NextResponse<EmbedResponse>
  const { id } = await context.params;
  const videoId = parseInt(id, 10);
  const timer = startApiTimer(`/api/videos/${id}/embed`, 'POST')
  try {

    if (isNaN(videoId)) {
      timer.end(400)
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid video ID',
          chunkCount: 0,
        },
        { status: 400 }
      );
    }

    // Fetch video with transcript
    const [video] = await db
      .select({ id: videos.id, transcript: videos.transcript })
      .from(videos)
      .where(eq(videos.id, videoId))
      .limit(1);

    if (!video) {
      timer.end(404)
      return NextResponse.json(
        {
          success: false,
          error: 'Video not found',
          chunkCount: 0,
        },
        { status: 404 }
      );
    }

    // Check if video has transcript
    if (!video.transcript) {
      timer.end(400)
      return NextResponse.json(
        {
          success: false,
          error: 'Video has no transcript',
          chunkCount: 0,
        },
        { status: 400 }
      );
    }

    // Parse transcript into segments
    const parsedSegments = parseTranscript(video.transcript);

    // Convert parsed segments to TranscriptSegment format
    const segments: TranscriptSegment[] = parsedSegments.map((seg) => ({
      text: seg.text,
      offset: seg.seconds * 1000, // Convert seconds to milliseconds
    }));

    // Chunk transcript
    const chunkedSegments = chunkTranscript(segments);

    if (chunkedSegments.length === 0) {
      timer.end(400)
      return NextResponse.json(
        {
          success: false,
          error: 'No chunks generated from transcript',
          chunkCount: 0,
        },
        { status: 400 }
      );
    }

    // Dynamic import to avoid ONNX native library crash on module load
    const { embedChunks } = await import('@/lib/embeddings/service')
    const embeddingResult = await embedChunks(chunkedSegments, undefined, videoId);

    if (embeddingResult.errorCount > 0) {
      const firstError = embeddingResult.chunks.find(c => c.error)?.error
      timer.end(500, { chunkCount: embeddingResult.successCount })
      return NextResponse.json(
        {
          success: false,
          error: `Failed to generate embeddings for ${embeddingResult.errorCount} chunks: ${firstError}`,
          chunkCount: embeddingResult.successCount,
        },
        { status: 500 }
      );
    }

    timer.end(200, { chunkCount: embeddingResult.successCount })
    return NextResponse.json({
      success: true,
      alreadyEmbedded: false,
      chunkCount: embeddingResult.successCount,
      durationMs: embeddingResult.durationMs,
      relationshipsCreated: embeddingResult.relationshipsCreated,
    });
  } catch (error) {
    console.error('Error generating embeddings:', error);
    timer.end(500)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
        chunkCount: 0,
      },
      { status: 500 }
    );
  }
}

/**
 * Configure route segment for Vercel
 * maxDuration allows longer-running operations (requires Pro plan)
 */
export const maxDuration = 300
