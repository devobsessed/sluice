import { describe, it, expect } from 'vitest'

/**
 * Tests for the domain restriction + access request hook in auth.ts.
 *
 * We can't easily test the full betterAuth() config without a running database,
 * so we extract and test the validation logic directly.
 * The hook's core logic is:
 *   1. If email.endsWith(`@${ALLOWED_EMAIL_DOMAIN}`), allow
 *   2. Else if access_requests has an approved row for this email, allow
 *   3. Else throw APIError FORBIDDEN
 */

const ALLOWED_DOMAIN = 'devobsessed.com'

/**
 * Simulates the auth hook logic.
 * approvedEmails represents the set of emails with status='approved' in access_requests.
 */
function validateEmailAccess(
  email: string,
  allowedDomain: string = ALLOWED_DOMAIN,
  approvedEmails: string[] = [],
): void {
  // Check 1: domain match
  if (email.endsWith(`@${allowedDomain}`)) {
    return
  }

  // Check 2: approved access request
  if (approvedEmails.includes(email)) {
    return
  }

  throw new Error(`Only @${allowedDomain} accounts are allowed`)
}

describe('auth domain restriction', () => {
  describe('domain match (existing behavior)', () => {
    it('accepts emails from the allowed domain', () => {
      expect(() => validateEmailAccess('user@devobsessed.com')).not.toThrow()
      expect(() => validateEmailAccess('admin@devobsessed.com')).not.toThrow()
      expect(() => validateEmailAccess('first.last@devobsessed.com')).not.toThrow()
    })

    it('rejects emails from other domains with no access request', () => {
      expect(() => validateEmailAccess('user@gmail.com')).toThrow(
        'Only @devobsessed.com accounts are allowed'
      )
      expect(() => validateEmailAccess('user@example.com')).toThrow(
        'Only @devobsessed.com accounts are allowed'
      )
    })

    it('rejects emails with the domain as a subdomain', () => {
      expect(() => validateEmailAccess('user@sub.devobsessed.com')).toThrow(
        'Only @devobsessed.com accounts are allowed'
      )
    })

    it('rejects emails that contain the domain but are not from it', () => {
      expect(() => validateEmailAccess('user@evildevobsessed.com')).toThrow(
        'Only @devobsessed.com accounts are allowed'
      )
    })

    it('supports custom allowed domain via parameter', () => {
      expect(() => validateEmailAccess('user@custom.org', 'custom.org')).not.toThrow()
      expect(() => validateEmailAccess('user@other.org', 'custom.org')).toThrow(
        'Only @custom.org accounts are allowed'
      )
    })
  })

  describe('approved access request fallback', () => {
    const approvedEmails = ['invited@gmail.com', 'partner@acme.co']

    it('allows non-domain email with approved access request', () => {
      expect(() => validateEmailAccess('invited@gmail.com', ALLOWED_DOMAIN, approvedEmails)).not.toThrow()
      expect(() => validateEmailAccess('partner@acme.co', ALLOWED_DOMAIN, approvedEmails)).not.toThrow()
    })

    it('rejects non-domain email without approved access request', () => {
      expect(() => validateEmailAccess('stranger@gmail.com', ALLOWED_DOMAIN, approvedEmails)).toThrow(
        'Only @devobsessed.com accounts are allowed'
      )
    })

    it('domain match still takes priority over access request check', () => {
      // Domain emails pass without needing an access request
      expect(() => validateEmailAccess('user@devobsessed.com', ALLOWED_DOMAIN, [])).not.toThrow()
    })
  })
})
