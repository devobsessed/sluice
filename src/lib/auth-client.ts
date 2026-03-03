import { createAuthClient } from 'better-auth/react'
import { oauthProviderClient } from '@better-auth/oauth-provider/client'

export const authClient = createAuthClient({
  baseURL: typeof window !== 'undefined'
    ? window.location.origin
    : process.env.BETTER_AUTH_URL ?? 'http://localhost:3001',
  plugins: [
    oauthProviderClient(),
  ],
})

export const {
  useSession,
  signIn,
  signUp,
  signOut,
} = authClient
