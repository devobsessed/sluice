import { oauthProviderResourceClient } from '@better-auth/oauth-provider/resource-client'
import { auth } from '@/lib/auth'

/**
 * OAuth Protected Resource Metadata (RFC 9728)
 *
 * MCP clients (e.g. mcp-remote) fetch this endpoint to discover the resource
 * server configuration, including which authorization servers protect it.
 *
 * Dev mode: Returns 404 so MCP clients fall back to unauthenticated connection.
 * Production: Returns protected resource metadata from Better Auth.
 *
 * @see https://datatracker.ietf.org/doc/html/rfc9728
 */
export async function GET(): Promise<Response> {
  // Dev mode: no OAuth needed — 404 tells MCP clients to skip auth
  if (process.env.NODE_ENV !== 'production') {
    return new Response(null, { status: 404 })
  }

  // Production: serve RFC 9728 protected resource metadata
  try {
    const client = oauthProviderResourceClient(auth)
    const metadata = await client.getActions().getProtectedResourceMetadata()
    return new Response(JSON.stringify(metadata), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch {
    return new Response(
      JSON.stringify({ error: 'OAuth not configured' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
