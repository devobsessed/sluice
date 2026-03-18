import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from '@/lib/db/schema'
import { sql } from 'drizzle-orm'

vi.mock('@/lib/auth-guards', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth-guards')>()
  return {
    ...actual,
    requireSession: vi.fn().mockResolvedValue(null),
  }
})

// Setup test database
const TEST_DATABASE_URL =
  process.env.DATABASE_URL?.replace(/\/goldminer$/, '/goldminer_test') ??
  'postgresql://goldminer:goldminer@localhost:5432/goldminer_test'

let pool: Pool
let testDb: ReturnType<typeof drizzle<typeof schema>>

// Mock the database module to use test database
vi.mock('@/lib/db', async () => {
  const actual = await vi.importActual<typeof import('@/lib/db')>('@/lib/db')
  return {
    ...actual,
    get db() {
      return testDb
    },
  }
})

// Import after mocking
const { GET, POST } = await import('../route')

describe('GET /api/focus-areas', () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    testDb = drizzle(pool, { schema })
  })

  beforeEach(async () => {
    await testDb.execute(sql`TRUNCATE focus_areas CASCADE`)
  })

  afterAll(async () => {
    await pool?.end()
  })

  it('returns empty array when no focus areas exist', async () => {
    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.focusAreas).toEqual([])
  })

  it('returns all focus areas', async () => {
    // Create focus areas
    await testDb.insert(schema.focusAreas).values([
      { name: 'React', color: '#61dafb' },
      { name: 'TypeScript', color: '#3178c6' },
      { name: 'Testing', color: null },
    ])

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.focusAreas).toHaveLength(3)
    expect(data.focusAreas[0].name).toBe('React')
    expect(data.focusAreas[0].color).toBe('#61dafb')
    expect(data.focusAreas[2].color).toBeNull()
  })
})

describe('POST /api/focus-areas', () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    testDb = drizzle(pool, { schema })
  })

  beforeEach(async () => {
    await testDb.execute(sql`TRUNCATE focus_areas CASCADE`)
  })

  afterAll(async () => {
    await pool?.end()
  })

  it('creates focus area with name only', async () => {
    const request = new Request('http://localhost:3000/api/focus-areas', {
      method: 'POST',
      body: JSON.stringify({ name: 'React' }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(201)
    expect(data.focusArea).toBeDefined()
    expect(data.focusArea.name).toBe('React')
    expect(data.focusArea.id).toBeDefined()
    expect(data.focusArea.createdAt).toBeDefined()
    expect(data.focusArea.color).toBeNull()
  })

  it('creates focus area with name and color', async () => {
    const request = new Request('http://localhost:3000/api/focus-areas', {
      method: 'POST',
      body: JSON.stringify({
        name: 'TypeScript',
        color: '#3178c6',
      }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(201)
    expect(data.focusArea.name).toBe('TypeScript')
    expect(data.focusArea.color).toBe('#3178c6')
  })

  it('returns 400 when name is missing', async () => {
    const request = new Request('http://localhost:3000/api/focus-areas', {
      method: 'POST',
      body: JSON.stringify({}),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBeDefined()
  })

  it('returns 400 when name is empty string', async () => {
    const request = new Request('http://localhost:3000/api/focus-areas', {
      method: 'POST',
      body: JSON.stringify({ name: '' }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBeDefined()
  })

  it('returns 409 when focus area name already exists', async () => {
    // Create existing focus area
    await testDb.insert(schema.focusAreas).values({ name: 'React' })

    const request = new Request('http://localhost:3000/api/focus-areas', {
      method: 'POST',
      body: JSON.stringify({ name: 'React' }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(409)
    expect(data.error).toContain('already exists')
  })

  it('trims whitespace from name', async () => {
    const request = new Request('http://localhost:3000/api/focus-areas', {
      method: 'POST',
      body: JSON.stringify({ name: '  React  ' }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(201)
    expect(data.focusArea.name).toBe('React')
  })
})
