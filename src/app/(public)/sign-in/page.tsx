'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Search, Sparkles, Users } from 'lucide-react'
import { SluiceLogo } from '@/components/icons/SluiceLogo'
import { signIn, signOut, useSession } from '@/lib/auth-client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const features = [
  {
    icon: Search,
    title: 'Hybrid Search',
    description: 'Find insights across your video library with vector + keyword search.',
  },
  {
    icon: Sparkles,
    title: 'AI Insights',
    description: 'Extract summaries, key takeaways, and action items from any video.',
  },
  {
    icon: Users,
    title: 'Creator Personas',
    description: 'Chat with AI personas trained on your favorite creators.',
  },
] as const

function SignInContent() {
  const { data: session, isPending } = useSession()
  const searchParams = useSearchParams()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const callbackUrl = searchParams.get('callbackUrl') || '/'

  async function handleGoogleSignIn() {
    setError(null)
    setLoading(true)

    try {
      const result = await signIn.social({
        provider: 'google',
        callbackURL: callbackUrl,
      })

      if (result.error) {
        const status = result.error.status
        if (status === 403) {
          setError('__403__')
        } else {
          setError(result.error.message ?? 'Sign in failed')
        }
        setLoading(false)
      }
    } catch {
      setError('Something went wrong. Please try again.')
      setLoading(false)
    }
  }

  if (isPending) {
    return <p className="text-muted-foreground">Loading...</p>
  }

  if (session) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-2">
            <SluiceLogo size={36} />
          </div>
          <CardTitle>Welcome back</CardTitle>
          <CardDescription>
            Signed in as {session.user.email}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button asChild className="w-full">
            <Link href="/">Go to Knowledge Bank</Link>
          </Button>
          <Button
            variant="outline"
            className="w-full"
            onClick={async () => {
              await signOut()
            }}
          >
            Sign out
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="w-full max-w-md space-y-8">
      <div className="text-center space-y-3">
        <div className="flex items-center justify-center gap-3">
          <SluiceLogo size={36} />
          <h1 className="text-3xl font-bold tracking-tight">Sluice</h1>
        </div>
        <p className="text-muted-foreground text-lg">
          Extract knowledge from YouTube videos into a searchable knowledge bank.
        </p>
      </div>

      <div className="grid gap-4 text-left">
        {features.map((feature) => {
          const Icon = feature.icon
          return (
            <div key={feature.title} className="flex items-start gap-3">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                <Icon className="h-4 w-4 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium">{feature.title}</p>
                <p className="text-sm text-muted-foreground">{feature.description}</p>
              </div>
            </div>
          )
        })}
      </div>

      <Card>
        <CardContent className="pt-6 space-y-4">
          {error && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-center text-sm text-destructive">
              {error === '__403__' ? (
                <>
                  Access restricted.{' '}
                  <Link href="/request-access" className="underline font-medium hover:text-destructive/80">
                    Request access
                  </Link>
                </>
              ) : (
                error
              )}
            </div>
          )}
          <Button
            className="w-full"
            size="lg"
            onClick={handleGoogleSignIn}
            disabled={loading}
          >
            <GoogleIcon />
            {loading ? 'Redirecting...' : 'Sign in with Google'}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  )
}

export default function SignInPage() {
  return (
    <Suspense fallback={<p className="text-muted-foreground">Loading...</p>}>
      <SignInContent />
    </Suspense>
  )
}
