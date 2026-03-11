import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { setupTestDb, teardownTestDb, getTestDb, schema } from './setup'

describe('access_requests table schema', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  afterAll(async () => {
    await teardownTestDb()
  })

  it('inserts a request with default pending status', async () => {
    const db = getTestDb()

    const [request] = await db
      .insert(schema.accessRequests)
      .values({
        email: 'user@external.com',
        name: 'External User',
      })
      .returning()

    expect(request).toBeDefined()
    expect(request!.email).toBe('user@external.com')
    expect(request!.name).toBe('External User')
    expect(request!.status).toBe('pending')
    expect(request!.message).toBeNull()
    expect(request!.createdAt).toBeInstanceOf(Date)
    expect(request!.updatedAt).toBeInstanceOf(Date)
  })

  it('accepts a message field', async () => {
    const db = getTestDb()

    const [request] = await db
      .insert(schema.accessRequests)
      .values({
        email: 'user@external.com',
        name: 'External User',
        message: 'I would like access to review AI content.',
      })
      .returning()

    expect(request!.message).toBe('I would like access to review AI content.')
  })

  it('enforces unique email constraint', async () => {
    const db = getTestDb()

    await db
      .insert(schema.accessRequests)
      .values({
        email: 'duplicate@external.com',
        name: 'First Request',
      })

    await expect(
      db
        .insert(schema.accessRequests)
        .values({
          email: 'duplicate@external.com',
          name: 'Second Request',
        })
    ).rejects.toThrow()
  })

  it('allows explicit status values', async () => {
    const db = getTestDb()

    const [approved] = await db
      .insert(schema.accessRequests)
      .values({
        email: 'approved@external.com',
        name: 'Approved User',
        status: 'approved',
      })
      .returning()

    const [denied] = await db
      .insert(schema.accessRequests)
      .values({
        email: 'denied@external.com',
        name: 'Denied User',
        status: 'denied',
      })
      .returning()

    expect(approved!.status).toBe('approved')
    expect(denied!.status).toBe('denied')
  })
})
