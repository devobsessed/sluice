import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Auth coverage verification test.
 *
 * Ensures every API route file has an auth check.
 * This test will FAIL if a new route is added without auth,
 * serving as a guardrail for future development.
 */
describe('API route auth coverage', () => {
  // Routes that are intentionally unauthenticated — skip auth check
  const AUTH_HANDLER_ROUTES = [
    'src/app/api/auth/[...all]/route.ts',       // Better Auth catch-all IS the auth system
    'src/app/api/access-requests/route.ts',      // Public endpoint for unauthenticated access requests
  ]

  // Auth patterns to look for in route file source code
  const AUTH_PATTERNS = [
    'requireSession',      // Shared session auth helper (primary)
    'verifyCronSecret',    // Cron route auth
    'safeCompare',         // Agent token-based auth
    'getMcpSession',       // MCP OAuth auth (legacy — replaced by verifyAccessToken)
    'verifyAccessToken',   // MCP OAuth2 access token verification (@better-auth/oauth-provider)
    'getSession',          // Inline session check (legacy routes not yet migrated)
  ]

  // Discover all route files by walking the api directory
  function findRouteFiles(dir: string): string[] {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path')
    const results: string[] = []

    function walk(currentDir: string) {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name)
        if (entry.isDirectory()) {
          walk(fullPath)
        } else if (entry.name === 'route.ts') {
          results.push(fullPath)
        }
      }
    }

    walk(dir)
    return results
  }

  it('every API route file has an auth check', () => {
    const projectRoot = resolve(__dirname, '../../..')
    const apiDir = resolve(projectRoot, 'src/app/api')
    const routeFiles = findRouteFiles(apiDir)

    // Sanity check — we know there are 34 routes
    expect(routeFiles.length).toBeGreaterThan(25)

    const unprotectedRoutes: string[] = []

    for (const fullPath of routeFiles) {
      // Convert to relative path for readability
      const relativePath = fullPath.replace(projectRoot + '/', '')

      // Skip the Better Auth catch-all
      if (AUTH_HANDLER_ROUTES.includes(relativePath)) continue

      const content = readFileSync(fullPath, 'utf-8')

      const hasAuth = AUTH_PATTERNS.some(pattern => content.includes(pattern))
      if (!hasAuth) {
        unprotectedRoutes.push(relativePath)
      }
    }

    expect(
      unprotectedRoutes,
      `These API routes have no auth check:\n${unprotectedRoutes.map(r => `  - ${r}`).join('\n')}\n\nAdd requireSession(), verifyCronSecret(), or appropriate auth to each route.`
    ).toEqual([])
  })

  it('route count matches expected total (update when adding new routes)', () => {
    const projectRoot = resolve(__dirname, '../../..')
    const apiDir = resolve(projectRoot, 'src/app/api')
    const routeFiles = findRouteFiles(apiDir)

    // Update this number when adding new routes — forces developer to
    // consciously decide on auth for the new route
    expect(routeFiles.length).toBe(38)
  })
})
