import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('isAdmin', () => {
  beforeEach(() => {
    vi.resetModules()
    delete process.env.ADMIN_EMAILS
  })

  async function getIsAdmin() {
    const mod = await import('@/lib/admin')
    return mod.isAdmin
  }

  it('returns false when ADMIN_EMAILS is not set', async () => {
    const isAdmin = await getIsAdmin()
    expect(isAdmin('anyone@example.com')).toBe(false)
  })

  it('returns false when ADMIN_EMAILS is empty string', async () => {
    process.env.ADMIN_EMAILS = ''
    const isAdmin = await getIsAdmin()
    expect(isAdmin('anyone@example.com')).toBe(false)
  })

  it('returns true for an email in the admin list', async () => {
    process.env.ADMIN_EMAILS = 'admin@devobsessed.com'
    const isAdmin = await getIsAdmin()
    expect(isAdmin('admin@devobsessed.com')).toBe(true)
  })

  it('handles multiple comma-separated emails', async () => {
    process.env.ADMIN_EMAILS = 'admin@devobsessed.com, other@devobsessed.com'
    const isAdmin = await getIsAdmin()
    expect(isAdmin('admin@devobsessed.com')).toBe(true)
    expect(isAdmin('other@devobsessed.com')).toBe(true)
    expect(isAdmin('stranger@devobsessed.com')).toBe(false)
  })

  it('comparison is case-insensitive', async () => {
    process.env.ADMIN_EMAILS = 'Admin@DevObsessed.com'
    const isAdmin = await getIsAdmin()
    expect(isAdmin('admin@devobsessed.com')).toBe(true)
    expect(isAdmin('ADMIN@DEVOBSESSED.COM')).toBe(true)
  })

  it('trims whitespace around emails', async () => {
    process.env.ADMIN_EMAILS = '  admin@devobsessed.com , other@devobsessed.com  '
    const isAdmin = await getIsAdmin()
    expect(isAdmin('admin@devobsessed.com')).toBe(true)
    expect(isAdmin('other@devobsessed.com')).toBe(true)
  })

  it('handles trailing commas gracefully', async () => {
    process.env.ADMIN_EMAILS = 'admin@devobsessed.com,'
    const isAdmin = await getIsAdmin()
    expect(isAdmin('admin@devobsessed.com')).toBe(true)
    expect(isAdmin('')).toBe(false)
  })
})
