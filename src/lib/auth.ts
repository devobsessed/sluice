import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { nextCookies } from 'better-auth/next-js'
import { jwt } from 'better-auth/plugins'
import { oauthProvider } from '@better-auth/oauth-provider'
import { APIError } from 'better-auth/api'
import { db } from '@/lib/db'
import { accessRequests } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

const ALLOWED_EMAIL_DOMAIN = (process.env.ALLOWED_EMAIL_DOMAIN ?? 'devobsessed.com').toLowerCase()

export const auth = betterAuth({
  disabledPaths: ['/token'],
  database: drizzleAdapter(db, {
    provider: 'pg',
  }),
  trustedOrigins: [
    'https://sluice.vercel.app',
    'https://sluice-devobsessed.vercel.app',
  ],
  emailAndPassword: {
    enabled: true,
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
      enabled: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          const email = user.email.trim().toLowerCase()

          // Check 1: domain match (existing behavior)
          if (email.endsWith(`@${ALLOWED_EMAIL_DOMAIN}`)) {
            return { data: user }
          }

          // Check 2: approved access request
          const [approved] = await db
            .select({ id: accessRequests.id })
            .from(accessRequests)
            .where(
              and(
                eq(accessRequests.email, email),
                eq(accessRequests.status, 'approved'),
              )
            )
            .limit(1)

          if (approved) {
            return { data: user }
          }

          throw new APIError('FORBIDDEN', {
            message: `Only @${ALLOWED_EMAIL_DOMAIN} accounts are allowed`,
          })
        },
      },
    },
  },
  plugins: [
    nextCookies(),
    jwt(),
    oauthProvider({
      loginPage: '/sign-in',
      consentPage: '/consent',
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      validAudiences: [
        process.env.BETTER_AUTH_URL || '',
        `${process.env.BETTER_AUTH_URL || ''}/`,
      ],
    }),
  ],
})
