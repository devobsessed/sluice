/**
 * Admin authorization utilities.
 * Admin emails are configured via the ADMIN_EMAILS env var (comma-separated).
 * Used for: API route protection, Settings page link visibility.
 */

/**
 * Parse the ADMIN_EMAILS env var into a Set of lowercase emails.
 * Handles whitespace around commas and empty strings gracefully.
 * Returns an empty Set if ADMIN_EMAILS is not set.
 */
function getAdminEmails(): Set<string> {
  const raw = process.env.ADMIN_EMAILS ?? ''
  if (!raw.trim()) return new Set()
  return new Set(
    raw.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
  )
}

/**
 * Check if the given email is in the admin list.
 * Comparison is case-insensitive.
 */
export function isAdmin(email: string): boolean {
  return getAdminEmails().has(email.toLowerCase())
}
