export interface RSSVideo {
  youtubeId: string
  title: string
  channelId: string
  channelName: string
  publishedAt: Date
  description: string
}

export interface RSSFeedResult {
  channelId: string
  channelName: string
  videos: RSSVideo[]
  fetchedAt: Date
}
