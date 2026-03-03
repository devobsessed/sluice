import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { db, videos } from '@/lib/db'
import { eq } from 'drizzle-orm'
import { VideoDetailClient } from './VideoDetailClient'

interface VideoDetailPageProps {
  params: Promise<{ id: string }>
}

async function getVideo(id: string) {
  const videoId = parseInt(id, 10)
  if (isNaN(videoId)) return null

  const result = await db
    .select()
    .from(videos)
    .where(eq(videos.id, videoId))
    .limit(1)

  return result[0] ?? null
}

export async function generateMetadata({ params }: VideoDetailPageProps): Promise<Metadata> {
  const { id } = await params
  const video = await getVideo(id)

  if (!video) {
    return {
      title: 'Video Not Found | Sluice',
    }
  }

  const description = video.channel
    ? `${video.channel} — ${video.description?.slice(0, 150) || 'Watch on Sluice'}`
    : video.description?.slice(0, 150) || 'Watch on Sluice'

  const metadata: Metadata = {
    title: `${video.title} | Sluice`,
    description,
    openGraph: {
      title: video.title,
      description,
      type: 'article',
      ...(video.thumbnail
        ? {
            images: [
              {
                url: video.thumbnail,
                width: 480,
                height: 360,
                alt: video.title,
              },
            ],
          }
        : {}),
    },
    twitter: {
      card: video.thumbnail ? 'summary_large_image' : 'summary',
      title: video.title,
      description,
      ...(video.thumbnail
        ? { images: [video.thumbnail] }
        : {}),
    },
  }

  return metadata
}

export default async function VideoDetailPage({ params }: VideoDetailPageProps) {
  const { id } = await params
  const video = await getVideo(id)

  if (!video) {
    notFound()
  }

  return <VideoDetailClient video={video} />
}
