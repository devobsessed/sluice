import { db, videos, searchVideos, getVideoStats, getDistinctChannels, videoFocusAreas, focusAreas, insights } from "@/lib/db";
import { eq, inArray } from "drizzle-orm";
import { NextResponse, after } from "next/server";
import { z } from "zod";
import { parseTranscript } from '@/lib/transcript/parse'
import { chunkTranscript } from '@/lib/embeddings/chunker'
import type { TranscriptSegment } from '@/lib/embeddings/types'
import { fetchVideoPageMetadata } from '@/lib/youtube/metadata'
import { startApiTimer } from '@/lib/api-timing'
import { start } from 'workflow/api'
import { embeddingsWorkflow } from '@/workflows/embeddings'
import { requireSession } from '@/lib/auth-guards'

const videoSchema = z.object({
  youtubeId: z.string().min(1).optional(),
  sourceType: z.enum(['youtube', 'transcript']).default('youtube'),
  title: z.string().min(1, "Title is required"),
  channel: z.string().optional(),
  thumbnail: z.string().optional(),
  transcript: z.string().min(50, "Transcript must be at least 50 characters"),
  tags: z.array(z.string()).optional(),
  notes: z.string().optional(),
  publishedAt: z.string().datetime().optional(), // ISO 8601 date string
  duration: z.number().int().positive().optional(),
  description: z.string().optional(),
}).superRefine((data, ctx) => {
  // Conditional validation: YouTube type requires channel
  if (data.sourceType === 'youtube' && !data.channel) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Channel is required for YouTube videos",
      path: ['channel'],
    });
  }
});

export async function GET(request: Request) {
  const denied = await requireSession()
  if (denied) return denied
  const timer = startApiTimer('/api/videos', 'GET')
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q') || '';
    const focusAreaIdParam = searchParams.get('focusAreaId');

    // Validate focusAreaId if provided
    let focusAreaId: number | null = null;
    if (focusAreaIdParam) {
      const parsed = parseInt(focusAreaIdParam, 10);
      if (isNaN(parsed)) {
        timer.end(400)
        return NextResponse.json({ error: 'Invalid focus area ID' }, { status: 400 });
      }
      focusAreaId = parsed;
    }

    const channelParam = searchParams.get('channel');

    // Search videos and stats in parallel
    const [searchResults, stats] = await Promise.all([
      searchVideos(query),
      getVideoStats(),
    ])
    let videoResults = searchResults

    // Filter by channel if provided (case-sensitive exact match)
    if (channelParam) {
      videoResults = videoResults.filter(v => v.channel === channelParam)
    }

    // Filter by focus area if provided
    if (focusAreaId !== null) {
      // Get video IDs assigned to this focus area
      const assignedVideos = await db
        .select({ videoId: videoFocusAreas.videoId })
        .from(videoFocusAreas)
        .where(eq(videoFocusAreas.focusAreaId, focusAreaId))

      const videoIds = assignedVideos.map(v => v.videoId)

      // Filter videos to only those assigned to the focus area
      if (videoIds.length === 0) {
        videoResults = []
      } else {
        videoResults = videoResults.filter(v => videoIds.includes(v.id))
      }
    }

    // Build focus area map and summary map in parallel
    const videoIds = videoResults.map(v => v.id)

    const focusAreaMap: Record<number, { id: number; name: string; color: string | null }[]> = {}
    const summaryMap: Record<number, string> = {}

    if (videoIds.length > 0) {
      const [assignments, insightRows] = await Promise.all([
        db
          .select({
            videoId: videoFocusAreas.videoId,
            id: focusAreas.id,
            name: focusAreas.name,
            color: focusAreas.color,
          })
          .from(videoFocusAreas)
          .innerJoin(focusAreas, eq(videoFocusAreas.focusAreaId, focusAreas.id))
          .where(inArray(videoFocusAreas.videoId, videoIds)),
        db
          .select({
            videoId: insights.videoId,
            extraction: insights.extraction,
          })
          .from(insights)
          .where(inArray(insights.videoId, videoIds)),
      ])

      for (const row of assignments) {
        const list = focusAreaMap[row.videoId] ?? (focusAreaMap[row.videoId] = [])
        list.push({ id: row.id, name: row.name, color: row.color })
      }

      for (const row of insightRows) {
        const extraction = row.extraction as { summary?: { tldr?: string } }
        const tldr = extraction?.summary?.tldr
        if (tldr) {
          summaryMap[row.videoId] = tldr
        }
      }
    }

    timer.end(200)
    return NextResponse.json(
      { videos: videoResults, stats, focusAreaMap, summaryMap },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error fetching videos:", error);
    timer.end(500)
    return NextResponse.json(
      { error: "Failed to fetch videos. Please try again." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const denied = await requireSession()
  if (denied) return denied
  const timer = startApiTimer('/api/videos', 'POST')
  try {
    const body = await request.json();

    // Validate request body
    const validationResult = videoSchema.safeParse(body);

    if (!validationResult.success) {
      const firstError = validationResult.error.issues[0];
      timer.end(400)
      return NextResponse.json(
        { error: firstError?.message || "Invalid request data" },
        { status: 400 }
      );
    }

    const { youtubeId, sourceType, title, channel, thumbnail, transcript, publishedAt, duration, description } = validationResult.data;

    // Conditional validation: YouTube type requires youtubeId
    if (sourceType === 'youtube' && !youtubeId) {
      timer.end(400)
      return NextResponse.json(
        { error: "YouTube ID is required for YouTube videos" },
        { status: 400 }
      );
    }

    // Convert empty string to undefined for null storage
    const channelValue = channel?.trim() ? channel : undefined;

    // Check for duplicate only for YouTube videos
    if (sourceType === 'youtube' && youtubeId) {
      const existingVideo = await db
        .select()
        .from(videos)
        .where(eq(videos.youtubeId, youtubeId))
        .limit(1);

      if (existingVideo.length > 0) {
        timer.end(409)
        return NextResponse.json(
          { error: "This video has already been added to your Knowledge Bank" },
          { status: 409 }
        );
      }
    }

    // Auto-fetch metadata if youtubeId present and any metadata field is missing
    let finalPublishedAt = publishedAt
    let finalDescription = description
    let finalDuration = duration

    if (youtubeId && (!publishedAt || !description || !duration)) {
      try {
        const metadata = await fetchVideoPageMetadata(youtubeId)
        // Only use fetched values for fields not provided by caller
        if (!publishedAt && metadata.publishedAt) {
          finalPublishedAt = metadata.publishedAt
        }
        if (!description && metadata.description) {
          finalDescription = metadata.description
        }
        if (!duration && metadata.duration) {
          finalDuration = metadata.duration
        }
      } catch (error) {
        console.warn(`Failed to fetch metadata for video ${youtubeId}:`, error)
        // Continue with save - graceful degradation
      }
    }

    // Insert video into database
    const result = await db
      .insert(videos)
      .values({
        youtubeId: youtubeId || null,
        sourceType,
        title,
        channel: channelValue || null,
        thumbnail: thumbnail || null,
        transcript,
        publishedAt: finalPublishedAt
          ? new Date(finalPublishedAt)
          : null,
        duration: finalDuration || null,
        description: finalDescription || null,
      })
      .returning();

    const createdVideo = result[0];

    // Auto-embed: local = inline after(), Vercel = durable workflow
    if (createdVideo && transcript && transcript.trim().length > 0) {
      if (process.env.VERCEL) {
        await start(embeddingsWorkflow, [createdVideo.id])
      } else {
        after(async () => {
          try {
            const parsedSegments = parseTranscript(transcript)
            const segments: TranscriptSegment[] = parsedSegments.map(seg => ({
              text: seg.text,
              offset: seg.seconds * 1000,
            }))
            const chunks = chunkTranscript(segments)
            if (chunks.length === 0) return
            const { embedChunks } = await import('@/lib/embeddings/service')
            const result = await embedChunks(chunks, undefined, createdVideo.id)
            console.log(`[auto-embed] Generated ${result.successCount} embeddings for video ${createdVideo.id}`)
          } catch (error) {
            console.error(`[auto-embed] Failed for video ${createdVideo.id}:`, error)
          }
        })
      }
    }

    if (!createdVideo) {
      timer.end(500)
      return NextResponse.json(
        { error: "Failed to create video" },
        { status: 500 }
      );
    }

    // Get milestone data
    const stats = await getVideoStats()
    const channels = await getDistinctChannels()
    const channelVideoCount = createdVideo.channel
      ? channels.find(c => c.channel === createdVideo.channel)?.videoCount ?? 0
      : 0

    timer.end(201, { videoId: createdVideo.id, sourceType })
    return NextResponse.json(
      {
        video: createdVideo,
        milestones: {
          totalVideos: stats.count,
          channelVideoCount,
          isNewChannel: channelVideoCount === 1 && createdVideo.channel !== null,
        }
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error creating video:", error);
    timer.end(500)
    return NextResponse.json(
      { error: "Failed to save video. Please try again." },
      { status: 500 }
    );
  }
}
