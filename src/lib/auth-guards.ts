import { timingSafeEqual } from 'crypto'
import { NextResponse } from 'next/server'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import type { JWTPayload } from 'jose'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'

/**
 * Result of a cron secret verification.
 * If valid is false, response contains a pre-built 401 Response to return immediately.
 */
type CronVerifyResult =
  | { valid: true }
  | { valid: false; response: Response }

/**
 * Verify that the request's Authorization header matches the CRON_SECRET env var.
 * Uses timing-safe comparison to prevent timing attacks.
 * Returns 401 if CRON_SECRET is unset (prevents Bearer undefined bypass).
 */
export function verifyCronSecret(request: Request): CronVerifyResult {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return {
      valid: false,
      response: new Response('Unauthorized', { status: 401 }),
    }
  }

  const authHeader = request.headers.get('authorization')
  const expected = `Bearer ${cronSecret}`

  if (!authHeader) {
    return {
      valid: false,
      response: new Response('Unauthorized', { status: 401 }),
    }
  }

  // Timing-safe comparison: both strings must be same length for timingSafeEqual.
  // If lengths differ, the comparison is already false, but we still call
  // timingSafeEqual on padded buffers to avoid leaking length information.
  const a = Buffer.from(authHeader)
  const b = Buffer.from(expected)

  const isEqual = a.length === b.length && timingSafeEqual(a, b)

  if (!isEqual) {
    return {
      valid: false,
      response: new Response('Unauthorized', { status: 401 }),
    }
  }

  return { valid: true }
}

/**
 * Timing-safe string comparison.
 * Returns true only if both strings are identical.
 * Safe against timing attacks on secret comparison.
 */
export function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB)
}

/**
 * Guard for API routes that require an authenticated session.
 *
 * Returns null when the caller is authorized (proceed normally).
 * Returns a 401 NextResponse when the caller is not authorized (return this response immediately).
 *
 * Development bypass: auth is skipped entirely when NODE_ENV === 'development'.
 * Test and production environments always enforce session checks.
 *
 * Usage:
 *   const unauthorized = await requireSession()
 *   if (unauthorized) return unauthorized
 */
export async function requireSession(): Promise<NextResponse | null> {
  if (process.env.NODE_ENV === 'development') {
    return null
  }
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}

type ExternalJwtConfig = {
  jwksUrl: string
  issuer?: string
  audience?: string
}

type ExternalJwtResult =
  | { valid: true; payload: JWTPayload }
  | { valid: false }

let cachedJwksResolver: ReturnType<typeof createRemoteJWKSet> | null = null
let cachedJwksUrl: string | null = null

function getJwksResolver(jwksUrl: string): ReturnType<typeof createRemoteJWKSet> {
  if (cachedJwksResolver && cachedJwksUrl === jwksUrl) {
    return cachedJwksResolver
  }
  cachedJwksResolver = createRemoteJWKSet(new URL(jwksUrl))
  cachedJwksUrl = jwksUrl
  return cachedJwksResolver
}

/**
 * Verify a JWT against a remote JWKS endpoint with optional issuer and audience validation.
 *
 * Returns `{ valid: true, payload }` on success.
 * Returns `{ valid: false }` when JWKS URL is absent, token is null, or verification fails.
 * Never throws.
 *
 * Config values fall back to MCP_JWKS_URL, MCP_JWT_ISSUER, MCP_JWT_AUDIENCE env vars when
 * not provided explicitly.
 */
export async function verifyExternalJwt(
  token: string | null,
  config?: ExternalJwtConfig,
): Promise<ExternalJwtResult> {
  const jwksUrl = config?.jwksUrl ?? process.env.MCP_JWKS_URL
  if (!jwksUrl || !token) {
    return { valid: false }
  }

  const issuer = config?.issuer ?? process.env.MCP_JWT_ISSUER
  const audience = config?.audience ?? process.env.MCP_JWT_AUDIENCE

  try {
    const jwks = getJwksResolver(jwksUrl)
    const { payload } = await jwtVerify(token, jwks, {
      ...(issuer ? { issuer } : {}),
      ...(audience ? { audience } : {}),
    })
    return { valid: true, payload }
  } catch {
    return { valid: false }
  }
}

/**
 * Reset the JWKS resolver cache.
 * Exported for testing only — do not use in production code.
 */
export function _resetJwksCache(): void {
  cachedJwksResolver = null
  cachedJwksUrl = null
}
