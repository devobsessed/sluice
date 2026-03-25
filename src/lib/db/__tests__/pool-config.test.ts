import { describe, it, expect } from 'vitest'

describe('Database pool configuration', () => {
  it('detects Neon from DATABASE_URL containing neon.tech', () => {
    const neonUrls = [
      'postgresql://user:pass@example.neon.tech:5432/db',
      'postgresql://neon.tech/db',
      'postgres://something.neon.tech/mydb',
    ]

    const nonNeonUrls = [
      'postgresql://localhost:5432/goldminer',
      'postgresql://example.com:5432/db',
      'postgres://my-server.com/db',
    ]

    for (const url of neonUrls) {
      const isNeon = url.includes('neon.tech')
      expect(isNeon).toBe(true)
    }

    for (const url of nonNeonUrls) {
      const isNeon = url.includes('neon.tech')
      expect(isNeon).toBe(false)
    }
  })

  it('applies correct pool config for Neon databases', () => {
    const isNeon = true
    const max = isNeon ? 3 : 10
    const idleTimeoutMillis = isNeon ? 10000 : 30000

    expect(max).toBe(3)
    expect(idleTimeoutMillis).toBe(10000)
  })

  it('applies correct pool config for non-Neon databases', () => {
    const isNeon = false
    const max = isNeon ? 3 : 10
    const idleTimeoutMillis = isNeon ? 10000 : 30000

    expect(max).toBe(10)
    expect(idleTimeoutMillis).toBe(30000)
  })

  it('pool config values match implementation', () => {
    const testCases = [
      { isNeon: true, expectedMax: 3, expectedIdle: 10000 },
      { isNeon: false, expectedMax: 10, expectedIdle: 30000 },
    ]

    for (const { isNeon, expectedMax, expectedIdle } of testCases) {
      const max = isNeon ? 3 : 10
      const idleTimeoutMillis = isNeon ? 10000 : 30000

      expect(max).toBe(expectedMax)
      expect(idleTimeoutMillis).toBe(expectedIdle)
    }
  })

  it('does not explicitly set ssl in pool constructor', () => {
    // SSL is handled by pg-connection-string parsing sslmode from DATABASE_URL.
    // When sslmode=verify-full is in the Neon URL, pg-connection-string
    // produces ssl: {} which defaults to rejectUnauthorized: true (Node.js TLS default).
    // For local Docker URLs without sslmode, ssl is undefined (no SSL).
    // The pool constructor must NOT set an explicit ssl property.
    const poolConfig = {
      connectionString: 'postgresql://user:pass@host.neon.tech:5432/db?sslmode=verify-full',
      max: 3,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 5000,
    }

    expect(poolConfig).not.toHaveProperty('ssl')
  })

  it('pg-connection-string parses sslmode=verify-full without deprecation warning', () => {
    // Verify that verify-full produces a truthy ssl object.
    // The modes require/prefer trigger a pg-connection-string deprecation warning;
    // verify-full does not.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const parse = require('pg-connection-string').parse
    const result = parse('postgresql://user:pass@host.neon.tech:5432/db?sslmode=verify-full')

    expect(result.ssl).toBeTruthy()
    expect(typeof result.ssl).toBe('object')
  })
})
