import { hybridSearch } from '@/lib/search/hybrid-search'
import type { SearchResult } from '@/lib/search/types'

/**
 * Fetches relevant context chunks for a persona query, scoped to the creator's channel.
 *
 * Uses hybrid search (vector + keyword) with an exact-match channel filter so the query
 * competes only within the creator's content - not the global knowledge bank. This ensures
 * small channels with fewer chunks surface relevant content instead of being drowned out.
 *
 * @param channelName - Name of the YouTube channel to scope context to
 * @param question - User's question to find relevant context for
 * @returns Array of up to 15 relevant chunks from the channel
 */
export async function getPersonaContext(
  channelName: string,
  question: string
): Promise<SearchResult[]> {
  // Scoped channel search - the channel filter is applied inside both query legs
  // (vector + keyword) before RRF fusion, so small-channel content is never starved
  // by global competition. Degraded flag not needed here - keyword-only fallback
  // results are still useful context for the persona.
  const { results } = await hybridSearch(question, {
    mode: 'hybrid',
    limit: 15,
    channel: channelName,
  })

  return results
}

/**
 * Formats search results as numbered context blocks for inclusion in system prompt.
 *
 * Creates a structured context string with:
 * - Numbered references for each chunk
 * - Source video title
 * - Timestamp (if available)
 * - Chunk content
 *
 * @param results - Search results to format
 * @returns Formatted context string, or empty string if no results
 */
export function formatContextForPrompt(results: SearchResult[]): string {
  if (results.length === 0) {
    return ''
  }

  return results
    .map((result, index) => {
      const number = index + 1
      const timestamp = result.startTime !== null ? `${result.startTime}s` : ''
      const timestampPart = timestamp ? ` (${timestamp})` : ''

      return `[${number}] From "${result.videoTitle}"${timestampPart}:\n${result.content}`
    })
    .join('\n\n')
}
