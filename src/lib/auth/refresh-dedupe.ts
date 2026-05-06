import { createHash } from 'crypto'
import { sql, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { oauthRefreshDedupe } from '@/lib/db/schema'

const CACHE_TTL_MS = 5_000

/**
 * Cached response shape stored in oauth_refresh_dedupe.response (JSONB).
 * Headers stored as tuples to preserve multi-value semantics (e.g., Set-Cookie).
 * Body stored as a string so we can replay it via Response constructor without
 * re-encoding. For binary bodies (not used here), this would need adjustment.
 */
export interface CachedResponse {
  status: number
  body: string
  headers: Array<[string, string]>
}

/**
 * Hash a refresh-token string for use as a dedupe key.
 * SHA-256 hex digest. Same input always produces the same key.
 * We hash because we never want the raw token in the database (defense in
 * depth - the dedupe row is short-lived and contains a valid token response,
 * but the lookup key itself should not be a usable credential).
 */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/**
 * Serialize a Response into a CachedResponse. Reads the body as text.
 * Returns null if body read fails (caller falls open).
 */
export async function serializeResponse(response: Response): Promise<CachedResponse | null> {
  try {
    const body = await response.clone().text()
    const headers: Array<[string, string]> = []
    response.headers.forEach((value, key) => {
      headers.push([key, value])
    })
    return { status: response.status, body, headers }
  } catch {
    return null
  }
}

/**
 * Reconstruct a Response from a CachedResponse. Drops content-length so the
 * runtime recomputes it (prevents mismatch if the cached body was re-encoded).
 */
export function deserializeResponse(cached: CachedResponse): Response {
  const headers = new Headers()
  for (const [key, value] of cached.headers) {
    if (key.toLowerCase() === 'content-length') continue
    headers.append(key, value)
  }
  return new Response(cached.body, {
    status: cached.status,
    headers,
  })
}

/**
 * Run dedupe for a refresh-token request.
 *
 * Flow inside a single Postgres transaction:
 *   1. Acquire pg_advisory_xact_lock keyed on hashtextextended(token_hash).
 *      Concurrent calls with the same hash serialize here.
 *   2. SELECT existing row WHERE token_hash = $1.
 *      - If row exists and expires_at > now(): return cached response.
 *      - If row exists and expired: DELETE it, fall through to forward.
 *      - If no row: fall through to forward.
 *   3. Forward the request via the supplied forward() callback.
 *   4. Serialize the forwarded response and INSERT it into the cache with
 *      expires_at = now() + 5s.
 *   5. Return the (still-readable) original response. The caller gets a
 *      fresh Response built from the serialized body via deserializeResponse,
 *      since the original Response body has been consumed by serialization.
 *
 * Fail-open: any thrown error from the dedupe path causes us to invoke
 * forward() OUTSIDE the transaction and return its result. The caller does
 * not need to catch - this function never throws on dedupe failure.
 *
 * @param tokenHash - SHA-256 hex digest of the refresh_token (caller hashes)
 * @param forward - Callback that invokes the underlying handler. Called at
 *                  most once per logical token-hash within the cache window.
 * @returns A Response (either freshly forwarded or replayed from cache).
 */
export async function dedupeRefreshRequest(
  tokenHash: string,
  forward: () => Promise<Response>,
): Promise<Response> {
  // Refined fail-open pattern: track whether forward() ran and its outcome,
  // so we never call it twice and never swallow its errors.
  let forwardResult: Response | null = null
  let forwardError: unknown = undefined

  const wrappedForward = async (): Promise<Response> => {
    try {
      forwardResult = await forward()
      return forwardResult
    } catch (e) {
      forwardError = e
      throw e
    }
  }

  try {
    return await db.transaction(async (tx) => {
      // Step 1: advisory lock keyed on the token hash.
      // hashtextextended returns bigint (signed 64-bit), which is what
      // pg_advisory_xact_lock expects for a single-arg call.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${tokenHash}, 0))`,
      )

      // Step 2: lookup cached response (lazy expire).
      const rows = await tx
        .select()
        .from(oauthRefreshDedupe)
        .where(eq(oauthRefreshDedupe.tokenHash, tokenHash))

      const existing = rows[0]
      if (existing) {
        if (existing.expiresAt.getTime() > Date.now()) {
          // Cache hit - return cached response WITHOUT calling forward().
          return deserializeResponse(existing.response as CachedResponse)
        }
        // Expired - delete and fall through.
        await tx
          .delete(oauthRefreshDedupe)
          .where(eq(oauthRefreshDedupe.tokenHash, tokenHash))
      }

      // Step 3: forward via the wrapper that tracks result/error.
      const response = await wrappedForward()

      // Step 4: serialize + cache.
      const serialized = await serializeResponse(response)
      if (serialized) {
        const expiresAt = new Date(Date.now() + CACHE_TTL_MS)
        // Use ON CONFLICT to be safe against the rare case where another
        // worker inserted between our SELECT and our INSERT (advisory lock
        // should prevent this within one DB, but defense in depth).
        await tx
          .insert(oauthRefreshDedupe)
          .values({ tokenHash, response: serialized, expiresAt })
          .onConflictDoUpdate({
            target: oauthRefreshDedupe.tokenHash,
            set: { response: serialized, expiresAt },
          })

        // Step 5: return a fresh Response (original body was consumed by serialize).
        return deserializeResponse(serialized)
      }

      // Serialization failed - return original response unread.
      return response
    })
  } catch (error) {
    // Refined fail-open: distinguish three error cases so we never
    // double-call forward() or swallow forward()'s real error.
    if (forwardError !== undefined) {
      // forward() itself threw - that's the real error, propagate it
      // exactly as if dedupe didn't exist. Do NOT call forward() again.
      throw forwardError
    }
    if (forwardResult !== null) {
      // forward() succeeded but cache write/serialization failed.
      // Return the response we already got - do NOT call forward() again.
      return forwardResult
    }
    // forward() never ran (DB unreachable, lock acquisition failed, etc).
    // Body of the original Request is still intact - safe to forward now.
    console.warn('OAuth refresh dedupe failed, falling through to handler', {
      error: error instanceof Error ? error.message : String(error),
    })
    return await forward()
  }
}

// Test-only export of the constant so tests can advance time deterministically.
export const __TEST_ONLY__ = { CACHE_TTL_MS }
