'use client'

import { useState } from 'react'
import Link from 'next/link'
import { CircleCheck, Loader2 } from 'lucide-react'
import { SluiceLogo } from '@/components/icons/SluiceLogo'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

type FormState = 'idle' | 'submitting' | 'success' | 'error'

export default function RequestAccessPage() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [formState, setFormState] = useState<FormState>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [submittedEmail, setSubmittedEmail] = useState('')

  const canSubmit = name.trim().length > 0 && email.trim().length > 0

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return

    setFormState('submitting')
    setErrorMessage(null)

    try {
      const res = await fetch('/api/access-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          message: message.trim() || undefined,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setErrorMessage(data.error ?? 'Something went wrong. Please try again.')
        setFormState('error')
        return
      }

      setSubmittedEmail(data.email)
      setFormState('success')
    } catch {
      setErrorMessage('Something went wrong. Please try again.')
      setFormState('error')
    }
  }

  return (
    <div className="w-full max-w-md space-y-8">
      <div className="text-center space-y-3">
        <div className="flex items-center justify-center gap-3">
          <SluiceLogo size={36} />
          <h1 className="text-3xl font-bold tracking-tight">Sluice</h1>
        </div>
      </div>

      <Card className="relative overflow-hidden">
        {formState === 'success' ? (
          <div
            className="animate-in fade-in duration-300"
            data-testid="success-state"
          >
            <CardContent className="pt-6 pb-2 text-center space-y-4">
              <div className="flex justify-center">
                <CircleCheck className="h-12 w-12 text-primary" />
              </div>
              <div className="space-y-2">
                <h2 className="text-xl font-semibold">Request received!</h2>
                <p className="text-sm text-muted-foreground">
                  We&apos;ll review it and get back to you at
                </p>
                <p className="text-sm font-medium">{submittedEmail}</p>
              </div>
            </CardContent>
            <CardFooter className="justify-center">
              <Button asChild variant="outline">
                <Link href="/sign-in">Back to sign in</Link>
              </Button>
            </CardFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <CardHeader>
              <CardTitle>Request Access</CardTitle>
              <CardDescription>Tell us a bit about yourself.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {errorMessage && (
                <div
                  className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-center text-sm text-destructive"
                  role="alert"
                >
                  {errorMessage}
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  type="text"
                  placeholder="Your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  disabled={formState === 'submitting'}
                  autoComplete="name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={formState === 'submitting'}
                  autoComplete="email"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="message">
                  Why do you want access?{' '}
                  <span className="text-muted-foreground font-normal">(optional)</span>
                </Label>
                <Textarea
                  id="message"
                  placeholder="Tell us why you're interested in Sluice..."
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  disabled={formState === 'submitting'}
                  rows={3}
                />
              </div>
              <Button
                type="submit"
                className="w-full"
                size="lg"
                disabled={!canSubmit || formState === 'submitting'}
              >
                {formState === 'submitting' ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  'Submit Request'
                )}
              </Button>
            </CardContent>
            <CardFooter className="justify-center">
              <p className="text-sm text-muted-foreground">
                Already have access?{' '}
                <Link href="/sign-in" className="text-primary hover:underline font-medium">
                  Sign in
                </Link>
              </p>
            </CardFooter>
          </form>
        )}
      </Card>
    </div>
  )
}
