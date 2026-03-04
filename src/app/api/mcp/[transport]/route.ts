import { createMcpHandler } from 'mcp-handler'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerSearchRag, registerGetListOfCreators, registerChatWithPersona, registerEnsembleQuery } from '@/lib/mcp/tools'
import { verifyAccessToken } from 'better-auth/oauth2'

/**
 * MCP Route Handler for Gold Miner
 *
 * Provides Model Context Protocol interface for Claude Code plugins.
 * Supports both SSE and HTTP transports via dynamic [transport] parameter.
 *
 * Available tools:
 * - search_rag: Search the knowledge base with optional creator filtering
 * - get_list_of_creators: List all creators with video counts
 * - chat_with_persona: Ask a question to a specific creator persona
 * - ensemble_query: Ask a question to all personas with "who's best" routing
 */

/**
 * Initialize the MCP server with registered tools
 * This function is called once when the handler is created
 */
async function initializeServer(server: McpServer): Promise<void> {
  registerSearchRag(server)
  registerGetListOfCreators(server)
  registerChatWithPersona(server)
  registerEnsembleQuery(server)
}

/**
 * Create the MCP handler with configuration
 */
const handler = createMcpHandler(
  initializeServer,
  {
    serverInfo: {
      name: 'gold-miner',
      version: '0.1.0',
    },
  },
  {
    streamableHttpEndpoint: '/api/mcp/mcp',
    sseEndpoint: '/api/mcp/sse',
    sseMessageEndpoint: '/api/mcp/message',
    maxDuration: 300,
    verboseLogs: process.env.NODE_ENV !== 'production',
  }
)

/**
 * Export GET and POST handlers for Next.js App Router
 * MCP protocol requires both methods to be available
 */
async function wrappedHandler(request: Request): Promise<Response> {
  // In production, verify OAuth access token via better-auth/oauth2
  // In development, skip auth so local MCP tools work without OAuth setup
  if (process.env.NODE_ENV === 'production') {
    const authUrl = process.env.BETTER_AUTH_URL ?? ''
    const authorization = request.headers.get('authorization')
    const accessToken = authorization?.startsWith('Bearer ')
      ? authorization.slice(7)
      : authorization

    if (!accessToken) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          'WWW-Authenticate': `Bearer resource_metadata="${authUrl}/.well-known/oauth-protected-resource"`,
        },
      })
    }

    try {
      await verifyAccessToken(accessToken, {
        verifyOptions: {
          issuer: `${authUrl}/api/auth`,
          audience: [authUrl, `${authUrl}/`],
        },
        jwksUrl: `${authUrl}/api/auth/jwks`,
      })
    } catch {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          'WWW-Authenticate': `Bearer resource_metadata="${authUrl}/.well-known/oauth-protected-resource"`,
        },
      })
    }
  }

  // MCP handler requires Accept header for streamable HTTP transport
  // Add it if missing
  if (!request.headers.get('accept')) {
    const headers = new Headers(request.headers)
    headers.set('accept', 'application/json, text/event-stream')

    request = new Request(request.url, {
      method: request.method,
      headers,
      body: request.body,
      duplex: 'half',
    } as RequestInit)
  }

  // mcp-handler may return a Turbopack polyfill Response whose body
  // ReadableStream is from a different realm. Native Response constructor
  // rejects cross-realm streams. Fix: buffer JSON, pipe SSE through
  // a native TransformStream.
  const result = await handler(request)

  // Do NOT short-circuit with `if (result instanceof Response) return result` here.
  // @hono/node-server replaces global.Response with its own Response2 subclass,
  // so instanceof checks fail cross-realm. All responses must flow through the
  // buffering/piping logic below which constructs genuine native Response objects.

  if (!result || typeof result !== 'object' || !('status' in result)) {
    return new Response(null, { status: 404 })
  }

  const src = result as Response
  const headers = new Headers()
  try {
    if (src.headers && typeof src.headers.forEach === 'function') {
      src.headers.forEach((v: string, k: string) => headers.set(k, v))
    }
  } catch { /* ignore header extraction errors */ }

  const contentType = headers.get('content-type') || ''

  if (contentType.includes('text/event-stream') && src.body) {
    // SSE stream: pipe polyfill ReadableStream through native TransformStream
    const { readable, writable } = new TransformStream()
    ;(src.body as ReadableStream).pipeTo(writable).catch(() => {})
    return new Response(readable, { status: src.status, headers })
  }

  // JSON/text: buffer body to avoid cross-realm stream issues
  const body = src.body ? await src.text() : null
  return new Response(body, { status: src.status, headers })
}

export { wrappedHandler as GET, wrappedHandler as POST }

/**
 * Configure route segment for Vercel
 * maxDuration allows longer-running MCP operations
 */
export const maxDuration = 300
