import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { setupTestDb, teardownTestDb, getTestDb, schema } from './setup'

describe('Videos table schema (nullable youtubeId + sourceType)', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  afterAll(async () => {
    await teardownTestDb()
  })

  it('allows null youtubeId', async () => {
    const db = getTestDb()

    // Should succeed: create video with null youtubeId
    const [video] = await db
      .insert(schema.videos)
      .values({
        youtubeId: null,
        title: 'Non-YouTube Video',
        channel: 'Manual Entry',
        transcript: 'Some text',
      })
      .returning()

    expect(video).toBeDefined()
    expect(video!.youtubeId).toBeNull()
  })

  it('applies default sourceType of youtube', async () => {
    const db = getTestDb()

    // Insert without sourceType specified
    const [video] = await db
      .insert(schema.videos)
      .values({
        youtubeId: 'abc123',
        title: 'Test Video',
        channel: 'Test Channel',
        transcript: 'Test transcript',
      })
      .returning()

    expect(video).toBeDefined()
    expect(video!.sourceType).toBe('youtube')
  })

  it('allows explicit sourceType', async () => {
    const db = getTestDb()

    const [video] = await db
      .insert(schema.videos)
      .values({
        youtubeId: null,
        title: 'Manual Video',
        channel: 'Manual Channel',
        transcript: 'Manual transcript',
        sourceType: 'manual',
      })
      .returning()

    expect(video).toBeDefined()
    expect(video!.sourceType).toBe('manual')
  })

  it('enforces unique youtubeId when not null', async () => {
    const db = getTestDb()

    // First insert succeeds
    await db
      .insert(schema.videos)
      .values({
        youtubeId: 'unique123',
        title: 'Video 1',
        channel: 'Channel',
        transcript: 'Transcript',
      })

    // Second insert with same youtubeId should fail
    await expect(
      db
        .insert(schema.videos)
        .values({
          youtubeId: 'unique123',
          title: 'Video 2',
          channel: 'Channel',
          transcript: 'Transcript',
        })
    ).rejects.toThrow()
  })

  it('allows multiple null youtubeIds (partial unique index)', async () => {
    const db = getTestDb()

    // First null youtubeId
    const [video1] = await db
      .insert(schema.videos)
      .values({
        youtubeId: null,
        title: 'Manual Video 1',
        channel: 'Channel 1',
        transcript: 'Transcript 1',
        sourceType: 'manual',
      })
      .returning()

    // Second null youtubeId should also succeed
    const [video2] = await db
      .insert(schema.videos)
      .values({
        youtubeId: null,
        title: 'Manual Video 2',
        channel: 'Channel 2',
        transcript: 'Transcript 2',
        sourceType: 'manual',
      })
      .returning()

    expect(video1).toBeDefined()
    expect(video2).toBeDefined()
    expect(video1!.youtubeId).toBeNull()
    expect(video2!.youtubeId).toBeNull()
  })
})

describe('oauth_refresh_dedupe table', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  afterAll(async () => {
    await teardownTestDb()
  })

  it('accepts insert and select with the documented shape', async () => {
    const db = getTestDb()
    const expiresAt = new Date(Date.now() + 5000)

    const [row] = await db
      .insert(schema.oauthRefreshDedupe)
      .values({
        tokenHash: 'a'.repeat(64),
        response: {
          status: 200,
          body: JSON.stringify({ access_token: 'x', token_type: 'Bearer' }),
          headers: [['content-type', 'application/json']],
        },
        expiresAt,
      })
      .returning()

    expect(row).toBeDefined()
    expect(row!.tokenHash).toBe('a'.repeat(64))
    expect(row!.response.status).toBe(200)
    expect(row!.response.headers[0]).toEqual(['content-type', 'application/json'])
  })

  it('enforces primary key uniqueness on token_hash', async () => {
    const db = getTestDb()
    const expiresAt = new Date(Date.now() + 5000)
    const baseRow = {
      tokenHash: 'b'.repeat(64),
      response: { status: 200, body: '{}', headers: [] as Array<[string, string]> },
      expiresAt,
    }

    await db.insert(schema.oauthRefreshDedupe).values(baseRow)
    await expect(
      db.insert(schema.oauthRefreshDedupe).values(baseRow)
    ).rejects.toThrow()
  })
})
