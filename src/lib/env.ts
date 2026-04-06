/**
 * Environment variable validation module.
 * Side-effect: importing this module runs validation.
 * Throws error if required env vars are missing (skipped during build).
 * Warns if optional env vars are missing.
 */

// Skip validation during Next.js build phase (static page generation)
const isBuildPhase = process.env.NEXT_PHASE === 'phase-production-build'

// Required environment variables
if (!process.env.DATABASE_URL && !isBuildPhase) {
  throw new Error('DATABASE_URL environment variable is required')
}

// Optional environment variables - warn if missing
if (!process.env.AI_GATEWAY_KEY) {
  console.warn('Warning: AI_GATEWAY_KEY not set. AI features will not work.')
} else {
  // Bridge for @anthropic-ai/sdk which reads ANTHROPIC_API_KEY from process.env
  process.env.ANTHROPIC_API_KEY = process.env.AI_GATEWAY_KEY.trim()
}

if (!process.env.CRON_SECRET) {
  console.warn('Warning: CRON_SECRET not set. Cron endpoints will not be secured.')
}

if (!process.env.BETTER_AUTH_SECRET) {
  console.warn('Warning: BETTER_AUTH_SECRET not set. Auth will use an insecure default in development.')
}

if (process.env.MCP_EXTERNAL_AUTH_PROVIDERS) {
  try {
    const providers = JSON.parse(process.env.MCP_EXTERNAL_AUTH_PROVIDERS)
    if (!Array.isArray(providers)) {
      console.error('Warning: MCP_EXTERNAL_AUTH_PROVIDERS is not a JSON array. External MCP JWT auth will not work.')
    } else {
      const invalid = providers.filter(
        (p: Record<string, unknown>) => !p?.audience || !p?.jwksUrl || !p?.name
      )
      if (invalid.length > 0) {
        console.error(
          `Warning: ${invalid.length} MCP_EXTERNAL_AUTH_PROVIDERS entries are missing required fields (name, jwksUrl, audience). They will be skipped.`
        )
      }
      console.log(`MCP external auth: ${providers.length - invalid.length} provider(s) configured.`)
    }
  } catch {
    console.error('Warning: MCP_EXTERNAL_AUTH_PROVIDERS is not valid JSON. External MCP JWT auth will not work.')
  }
}

// Note: NEXT_PUBLIC_AGENT_PORT is not validated -- it has a sensible default

export {}
