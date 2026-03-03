import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getSessionCookie } from 'better-auth/cookies'

/**
 * Next.js 16 Proxy (replaces middleware.ts)
 *
 * Enforces authentication in production only.
 * In development, all requests pass through unchanged.
 *
 * Protected: all app pages and API routes not in the public list.
 * Public: /sign-in, /api/auth/*, /.well-known/*, /api/cron/*
 *
 * Page requests without a session redirect to /sign-in.
 * API requests without a session return 401 JSON.
 */

const PUBLIC_PAGE_PATHS = ['/sign-in', '/opengraph-image', '/twitter-image']

const PUBLIC_API_PREFIXES = ['/api/auth', '/.well-known', '/api/cron']

function isPublicPath(pathname: string): boolean {
  // Exact match for public pages
  if (PUBLIC_PAGE_PATHS.includes(pathname)) {
    return true
  }

  // Prefix match for public API routes
  for (const prefix of PUBLIC_API_PREFIXES) {
    if (pathname.startsWith(prefix)) {
      return true
    }
  }

  return false
}

export function proxy(request: NextRequest) {
  // In development, skip all auth checks
  if (process.env.NODE_ENV !== 'production') {
    return NextResponse.next()
  }

  const { pathname } = request.nextUrl

  // Allow public paths through without auth
  if (isPublicPath(pathname)) {
    return NextResponse.next()
  }

  // Check for BetterAuth session cookie
  const sessionCookie = getSessionCookie(request)

  if (sessionCookie) {
    // Authenticated -- allow through
    return NextResponse.next()
  }

  // Unauthenticated in production -- handle based on request type
  if (pathname.startsWith('/api/')) {
    // API routes return 401 JSON
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 },
    )
  }

  // Page routes redirect to sign-in
  const signInUrl = new URL('/sign-in', request.url)
  signInUrl.searchParams.set('callbackUrl', pathname)
  return NextResponse.redirect(signInUrl)
}

/**
 * Matcher config -- tells Next.js which routes to run the proxy on.
 * Excludes static files, images, and Next.js internals.
 */
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico, sitemap.xml, robots.txt (metadata files)
     * - Public file extensions (svg, png, jpg, etc.)
     */
    '/((?!_next/static|_next/image|favicon\\.ico|sitemap\\.xml|robots\\.txt|api/mcp/.*|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
