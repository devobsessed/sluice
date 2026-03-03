'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Bot, CircleCheck, Loader2 } from 'lucide-react'
import { SluiceLogo } from '@/components/icons/SluiceLogo'
import { authClient, signOut, useSession } from '@/lib/auth-client'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

const SCOPE_LABELS: Record<string, { label: string, description: string }> = {
  openid: { label: 'Verify your identity', description: 'Confirm who you are' },
  profile: { label: 'View your profile', description: 'Access your name and profile info' },
  email: { label: 'View your email address', description: 'See your email' },
}

function getScopeDisplay(scope: string): { label: string, description: string } {
  return SCOPE_LABELS[scope] ?? { label: scope, description: `Access: ${scope}` }
}

interface ClientInfo {
  name: string | null
  icon: string | null
  uri: string | null
}

function ConsentContent() {
  const { data: session, isPending: sessionLoading } = useSession()
  const searchParams = useSearchParams()
  const clientId = searchParams.get('client_id')
  const scopeParam = searchParams.get('scope')
  const scopes = scopeParam ? scopeParam.split(' ').filter(Boolean) : []

  const [clientInfo, setClientInfo] = useState<ClientInfo | null>(null)
  // Only loading if we have a clientId to fetch — otherwise no request is needed
  const [clientLoading, setClientLoading] = useState(!!clientId)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!clientId) {
      return
    }
    fetch(`/api/oauth/client?client_id=${encodeURIComponent(clientId)}`)
      .then(res => res.json())
      .then((data: { data?: ClientInfo }) => {
        if (data.data) setClientInfo(data.data)
      })
      .catch(() => {
        // client lookup failed, will use fallback name
      })
      .finally(() => setClientLoading(false))
  }, [clientId])

  // Redirect to sign-in if not authenticated (effect avoids render-time side effects)
  useEffect(() => {
    if (!sessionLoading && !session) {
      window.location.href = `/sign-in?callbackUrl=${encodeURIComponent(window.location.pathname + window.location.search)}`
    }
  }, [sessionLoading, session])

  async function handleAllow() {
    setError(null)
    setSubmitting(true)
    try {
      await authClient.oauth2.consent({
        accept: true,
      })
      setSuccess(true)
      // The plugin handles the redirect after consent
    } catch {
      setError('Something went wrong approving access. Please try again.')
      setSubmitting(false)
    }
  }

  async function handleDeny() {
    setError(null)
    setSubmitting(true)
    try {
      await authClient.oauth2.consent({
        accept: false,
      })
      // The plugin handles the redirect (error response to client)
    } catch {
      setError('Something went wrong. Please try again.')
      setSubmitting(false)
    }
  }

  // Loading state while session or client info loads
  if (sessionLoading || clientLoading) {
    return (
      <div className="flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  // Not signed in — redirect handled by useEffect above
  if (!session) {
    return null
  }

  // Success state — green checkmark before redirect
  if (success) {
    return (
      <div className="flex flex-col items-center gap-4 animate-in fade-in duration-200">
        <CircleCheck className="h-16 w-16 text-primary" />
        <p className="text-lg font-medium">Access granted</p>
        <p className="text-sm text-muted-foreground">Redirecting...</p>
      </div>
    )
  }

  const displayName = clientInfo?.name ?? 'An application'

  return (
    <div className="w-full max-w-md animate-in fade-in slide-in-from-bottom-2 duration-200 motion-reduce:animate-none">
      {/* Sluice branding */}
      <div className="flex items-center justify-center gap-2 mb-8">
        <SluiceLogo size={28} />
        <span className="text-lg font-semibold">Sluice</span>
      </div>

      <Card>
        <CardContent className="pt-6 space-y-6">
          {/* Client identity */}
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-muted">
              {clientInfo?.icon ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={clientInfo.icon} alt="" className="h-8 w-8 rounded" />
              ) : (
                <Bot className="h-6 w-6 text-muted-foreground" />
              )}
            </div>
            <div>
              <p className="font-semibold">{displayName}</p>
              <p className="text-sm text-muted-foreground">
                wants access to your Sluice data
              </p>
            </div>
          </div>

          {/* Permissions list */}
          {scopes.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm font-medium text-muted-foreground">
                This will allow it to:
              </p>
              <ul className="space-y-2">
                {scopes.map(scope => {
                  const display = getScopeDisplay(scope)
                  return (
                    <li key={scope} className="flex items-start gap-2">
                      <CircleCheck className="h-5 w-5 shrink-0 text-primary mt-0.5" />
                      <span className="text-sm">{display.label}</span>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-center text-sm text-destructive">
              {error}
            </div>
          )}

          {/* Action buttons */}
          <div className="space-y-2">
            <Button
              className="w-full transition-transform hover:scale-[1.02] hover:shadow-md motion-reduce:hover:scale-100 motion-reduce:hover:shadow-none"
              size="lg"
              onClick={handleAllow}
              disabled={submitting}
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                'Allow Access'
              )}
            </Button>
            <Button
              variant="ghost"
              className="w-full"
              onClick={handleDeny}
              disabled={submitting}
            >
              Deny
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Footer — signed in as */}
      <div className="mt-4 text-center text-sm text-muted-foreground">
        <p>Signed in as {session.user.email}</p>
        <button
          className="text-primary hover:underline underline-offset-4 mt-1"
          onClick={async () => {
            await signOut()
            window.location.href = '/sign-in'
          }}
        >
          Not you? Sign out
        </button>
      </div>
    </div>
  )
}

export default function ConsentPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    }>
      <ConsentContent />
    </Suspense>
  )
}
