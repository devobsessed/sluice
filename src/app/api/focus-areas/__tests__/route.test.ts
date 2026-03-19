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

// Import both route handlers after mocking
const { GET, POST } = await import('../route')
const { PATCH, DELETE } = await import('../[id]/route')

beforeAll(async () => {
  pool = new Pool({ connectionString: TEST_DATABASE_URL })
  testDb = drizzle(pool, { schema })
})

afterAll(async () => {
  await pool?.end()
})

describe('GET /api/focus-areas', () => {
  beforeEach(async () => {
    await testDb.execute(sql`TRUNCATE focus_areas CASCADE`)
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
  beforeEach(async () => {
    await testDb.execute(sql`TRUNCATE focus_areas CASCADE`)
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

describe('PATCH /api/focus-areas/[id]', () => {
  beforeEach(async () => {
    await testDb.execute(sql`TRUNCATE focus_areas CASCADE`)
  })

  it('updates focus area name', async () => {
    // Create focus area
    const [focusArea] = await testDb
      .insert(schema.focusAreas)
      .values({ name: 'Angular' })
      .returning()

    const request = new Request(`http://localhost:3000/api/focus-areas/${focusArea!.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Angular.js' }),
    })

    const response = await PATCH(request, { params: Promise.resolve({ id: String(focusArea!.id) }) })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.focusArea.name).toBe('Angular.js')
    expect(data.focusArea.id).toBe(focusArea!.id)
  })

  it('updates focus area color', async () => {
    const [focusArea] = await testDb
      .insert(schema.focusAreas)
      .values({ name: 'Angular', color: '#000000' })
      .returning()

    const request = new Request(`http://localhost:3000/api/focus-areas/${focusArea!.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ color: '#61dafb' }),
    })

    const response = await PATCH(request, { params: Promise.resolve({ id: String(focusArea!.id) }) })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.focusArea.color).toBe('#61dafb')
    expect(data.focusArea.name).toBe('Angular') // name unchanged
  })

  it('returns 400 when name is empty string', async () => {
    const [focusArea] = await testDb
      .insert(schema.focusAreas)
      .values({ name: 'Angular' })
      .returning()

    const request = new Request(`http://localhost:3000/api/focus-areas/${focusArea!.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: '' }),
    })

    const response = await PATCH(request, { params: Promise.resolve({ id: String(focusArea!.id) }) })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBeDefined()
  })

  it('returns 404 when focus area does not exist', async () => {
    const request = new Request('http://localhost:3000/api/focus-areas/99999', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Updated' }),
    })

    const response = await PATCH(request, { params: Promise.resolve({ id: '99999' }) })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toContain('not found')
  })

  it('returns 409 when new name conflicts with existing focus area', async () => {
    // Create two focus areas
    const [first] = await testDb.insert(schema.focusAreas).values({ name: 'Angular' }).returning()
    await testDb.insert(schema.focusAreas).values({ name: 'Svelte' })

    const request = new Request(`http://localhost:3000/api/focus-areas/${first!.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Svelte' }),
    })

    const response = await PATCH(request, { params: Promise.resolve({ id: String(first!.id) }) })
    const data = await response.json()

    expect(response.status).toBe(409)
    expect(data.error).toContain('already exists')
  })

  it('trims whitespace from name', async () => {
    const [focusArea] = await testDb
      .insert(schema.focusAreas)
      .values({ name: 'Angular' })
      .returning()

    const request = new Request(`http://localhost:3000/api/focus-areas/${focusArea!.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: '  Ember.js  ' }),
    })

    const response = await PATCH(request, { params: Promise.resolve({ id: String(focusArea!.id) }) })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.focusArea.name).toBe('Ember.js')
  })
})

describe('DELETE /api/focus-areas/[id]', () => {
  beforeEach(async () => {
    await testDb.execute(sql`TRUNCATE videos, focus_areas CASCADE`)
  })

  it('deletes focus area', async () => {
    const [focusArea] = await testDb
      .insert(schema.focusAreas)
      .values({ name: 'Angular' })
      .returning()

    const request = new Request(`http://localhost:3000/api/focus-areas/${focusArea!.id}`, {
      method: 'DELETE',
    })

    const response = await DELETE(request, { params: Promise.resolve({ id: String(focusArea!.id) }) })

    expect(response.status).toBe(204)

    // Verify deletion
    const focusAreas = await testDb.select().from(schema.focusAreas)
    expect(focusAreas).toHaveLength(0)
  })

  it('returns 404 when focus area does not exist', async () => {
    const request = new Request('http://localhost:3000/api/focus-areas/99999', {
      method: 'DELETE',
    })

    const response = await DELETE(request, { params: Promise.resolve({ id: '99999' }) })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toContain('not found')
  })

  it('cascades delete to video_focus_areas junction table', async () => {
    // Create video and focus area
    const [video] = await testDb
      .insert(schema.videos)
      .values({
        youtubeId: 'test-123',
        title: 'Test Video',
        channel: 'Test Channel',
        transcript: 'Test transcript',
      })
      .returning()

    const [focusArea] = await testDb
      .insert(schema.focusAreas)
      .values({ name: 'Angular' })
      .returning()

    // Create junction entry
    await testDb.insert(schema.videoFocusAreas).values({
      videoId: video!.id,
      focusAreaId: focusArea!.id,
    })

    // Delete focus area
    const request = new Request(`http://localhost:3000/api/focus-areas/${focusArea!.id}`, {
      method: 'DELETE',
    })

    await DELETE(request, { params: Promise.resolve({ id: String(focusArea!.id) }) })

    // Verify junction entry deleted
    const junctions = await testDb.select().from(schema.videoFocusAreas)
    expect(junctions).toHaveLength(0)

    // Video should still exist
    const videos = await testDb.select().from(schema.videos)
    expect(videos).toHaveLength(1)
  })
})
