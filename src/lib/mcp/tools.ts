import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { hybridSearch } from '@/lib/search/hybrid-search'
import { aggregateByVideo } from '@/lib/search/aggregate'
import { getDistinctChannels } from '@/lib/db/search'
import { db, personas } from '@/lib/db'
import { getPersonaContext, formatContextForPrompt } from '@/lib/personas/context'
import { findBestPersonas } from '@/lib/personas/ensemble'
import { getExtractionForVideo } from '@/lib/db/insights'
import { generateText } from '@/lib/claude/client'
import { buildSystemParamForMcp } from '@/lib/personas/streaming'

/**
 * Register the search_rag tool with the MCP server.
 *
 * This tool searches the Gold Miner knowledge base for relevant content
 * from YouTube videos. It supports filtering by creator/channel name.
 * Includes knowledge prompts from video extractions when available.
 *
 * @param server - MCP server instance to register the tool with
 */
export function registerSearchRag(server: McpServer): void {
  server.registerTool(
    'search_rag',
    {
      title: 'Search RAG',
      description: 'Search the Gold Miner knowledge base for relevant content from YouTube videos',
      inputSchema: {
        topic: z.string().describe('Search query for the knowledge base'),
        creator: z.string().optional().describe('Filter by creator/channel name'),
        limit: z.number().int().min(1).max(50).default(10).optional().describe('Max results'),
      },
    },
    async ({ topic, creator, limit }) => {
      let searchResults: Awaited<ReturnType<typeof hybridSearch>>['results']

      if (creator) {
        // Resolve the fuzzy creator string to an exact channel name via case-insensitive
        // substring match. This preserves today's fuzzy ergonomics while moving the filter
        // inside the query legs (before RRF fusion) so small channels are no longer starved.
        const channels = await getDistinctChannels()
        const resolvedChannel = channels.find(
          c => c.channel.toLowerCase().includes(creator.toLowerCase())
        )?.channel

        if (!resolvedChannel) {
          // No channel matched - return empty rather than falling back to global search,
          // matching the observable behavior of the old post-filter on an unmatched creator.
          const videos = aggregateByVideo([])
          return {
            content: [{ type: 'text', text: JSON.stringify(videos, null, 2) }],
          }
        }

        const { results } = await hybridSearch(topic, { limit: limit ?? 10, channel: resolvedChannel })
        searchResults = results
      } else {
        // No creator: global search unchanged
        const { results } = await hybridSearch(topic, { limit: limit ?? 10 })
        searchResults = results
      }

      // Aggregate results by video
      const videos = aggregateByVideo(searchResults)

      // Enrich with knowledge prompts from insights
      const enrichedVideos = await Promise.all(
        videos.map(async (video) => {
          const extraction = await getExtractionForVideo(video.videoId)

          if (extraction?.extraction?.knowledgePrompt) {
            return {
              ...video,
              knowledgePrompt: extraction.extraction.knowledgePrompt,
            }
          }

          return video
        })
      )

      // Format response with knowledge prompts clearly labeled
      let responseText = JSON.stringify(enrichedVideos, null, 2)

      // If any videos have knowledge prompts, add a helpful header
      const hasKnowledgePrompts = enrichedVideos.some(v => 'knowledgePrompt' in v)
      if (hasKnowledgePrompts) {
        responseText = '# Search Results with Knowledge Prompts\n\n' +
          'Videos with a `knowledgePrompt` field contain distilled learnings and actionable techniques from the content.\n\n' +
          responseText
      }

      // Return formatted response
      return {
        content: [{ type: 'text', text: responseText }],
      }
    }
  )
}

/**
 * Register the get_list_of_creators tool with the MCP server.
 *
 * This tool returns all distinct YouTube channels (creators) in the knowledge base
 * with their video counts, sorted by video count descending.
 *
 * @param server - MCP server instance to register the tool with
 */
export function registerGetListOfCreators(server: McpServer): void {
  server.registerTool(
    'get_list_of_creators',
    {
      title: 'Get List of Creators',
      description: 'Returns all distinct YouTube channels (creators) in the knowledge base with video counts',
      inputSchema: {},
    },
    async () => {
      const creators = await getDistinctChannels()
      return {
        content: [{ type: 'text', text: JSON.stringify(creators, null, 2) }],
      }
    }
  )
}

/**
 * Makes a non-streaming query for a persona question.
 * Reuses persona context scoping and prompt building patterns.
 */
async function queryPersona(
  personaName: string,
  question: string,
): Promise<{ text: string, sources: { videoTitle: string, content: string }[] }> {
  const allPersonas = await db.select().from(personas)
  const persona = allPersonas.find(
    p => p.name.toLowerCase() === personaName.toLowerCase()
      || p.channelName.toLowerCase() === personaName.toLowerCase()
  )

  if (!persona) {
    throw new Error(`Persona not found: ${personaName}`)
  }

  // Get scoped context for this persona
  const context = await getPersonaContext(persona.channelName, question)
  const formattedContext = formatContextForPrompt(context)

  // Build v2 system param using the shared guard helper.
  // buildSystemParamForMcp applies the zero-retrieval guard (and weak-retrieval
  // soft signal) but NEVER adds ask-back permission - one-shot tool calls need
  // answers, not questions. It also emits the [persona-guard] log line so the
  // guard is observable at run time.
  const system = buildSystemParamForMcp(persona, context)

  // Serialize system + context + question into a single string for generateText
  // (generateText is single-string, mirroring the local-serialization in streamMessages).
  let prompt = system
  if (formattedContext) {
    prompt += '\n\n<context>\n' + formattedContext + '\n</context>'
  }
  prompt += '\n\n' + question

  const text = await generateText(prompt)

  const sources = context.slice(0, 5).map(c => ({
    videoTitle: c.videoTitle,
    content: c.content.slice(0, 200),
  }))

  return { text, sources }
}

/**
 * Register the chat_with_persona tool with the MCP server.
 *
 * Queries a single persona agent scoped to a creator's content.
 * Returns a non-streaming text response with source citations.
 */
export function registerChatWithPersona(server: McpServer): void {
  server.registerTool(
    'chat_with_persona',
    {
      title: 'Chat with Persona',
      description: 'Ask a question to a specific creator persona. The persona responds based on their YouTube content and expertise.',
      inputSchema: {
        personaName: z.string().describe('Name of the persona/creator to chat with'),
        question: z.string().describe('Question to ask the persona'),
      },
    },
    async ({ personaName, question }) => {
      try {
        const { text, sources } = await queryPersona(personaName, question)

        const response = {
          persona: personaName,
          answer: text,
          sources,
        }

        return {
          content: [{ type: 'text', text: JSON.stringify(response, null, 2) }],
        }
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }],
          isError: true,
        }
      }
    }
  )
}

/**
 * Register the ensemble_query tool with the MCP server.
 *
 * Queries multiple personas in parallel and returns side-by-side responses
 * with "who's best" routing based on expertise embedding similarity.
 */
export function registerEnsembleQuery(server: McpServer): void {
  server.registerTool(
    'ensemble_query',
    {
      title: 'Ensemble Query',
      description: 'Ask a question to all persona agents. Returns side-by-side responses from multiple creators with "who\'s best" routing.',
      inputSchema: {
        question: z.string().describe('Question to ask all personas'),
      },
    },
    async ({ question }) => {
      try {
        // Get all personas
        const allPersonas = await db.select().from(personas)

        if (allPersonas.length === 0) {
          return {
            content: [{ type: 'text', text: 'No personas available. Create personas first by ingesting 5+ transcripts from a creator.' }],
          }
        }

        // Find best match
        const bestMatches = await findBestPersonas(question, allPersonas, 1)
        const bestPersona = bestMatches[0]

        // Query top 3 personas (sorted by relevance)
        const topPersonas = await findBestPersonas(question, allPersonas, 3)
        const personasToQuery = topPersonas.map(r => r.persona)

        // Query each persona in parallel
        const results = await Promise.allSettled(
          personasToQuery.map(async (persona) => {
            const { text, sources } = await queryPersona(persona.name, question)
            return {
              persona: persona.name,
              answer: text,
              sources,
            }
          })
        )

        const responses = results
          .filter((r): r is PromiseFulfilledResult<{ persona: string, answer: string, sources: { videoTitle: string, content: string }[] }> =>
            r.status === 'fulfilled'
          )
          .map(r => r.value)

        const response = {
          question,
          bestMatch: bestPersona ? {
            persona: bestPersona.persona.name,
            score: bestPersona.score,
          } : null,
          responses,
        }

        return {
          content: [{ type: 'text', text: JSON.stringify(response, null, 2) }],
        }
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }],
          isError: true,
        }
      }
    }
  )
}
