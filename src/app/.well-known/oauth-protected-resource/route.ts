/**
 * OAuth Protected Resource Metadata (RFC 9728)
 *
 * MCP clients (e.g. mcp-remote) fetch this endpoint to discover the resource
 * server configuration, including which authorization servers protect it.
 *
 * Dev mode: Returns 404 so MCP clients fall back to unauthenticated connection.
 * Production: Returns metadata built from BETTER_AUTH_URL.
 *
 * @see https://datatracker.ietf.org/doc/html/rfc9728
 */
export async function GET(): Promise<Response> {
  // Dev mode: no OAuth needed — 404 tells MCP clients to skip auth
  if (process.env.NODE_ENV !== 'production') {
    return new Response(null, { status: 404 })
  }

  // Production: serve RFC 9728 protected resource metadata
  // Built manually — oauthProviderResourceClient crashes on Vercel serverless
  const authUrl = process.env.BETTER_AUTH_URL
  if (!authUrl) {
    return new Response(
      JSON.stringify({ error: 'BETTER_AUTH_URL not configured' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const metadata = {
    resource: authUrl,
    authorization_servers: [`${authUrl}/api/auth`],
    bearer_methods_supported: ['header'],
  }

  return new Response(JSON.stringify(metadata), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
