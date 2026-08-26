import { GoogleLogin } from '@react-oauth/google'
import { useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'

import { ApiError } from '@/api/client'
import { useAuth } from '@/auth/AuthContext'
import { Card, ErrorNote, Spinner } from '@/components/ui'

const CAMPUS_DOMAIN = 'pilani.bits-pilani.ac.in'

export function LoginPage() {
  const { user, loading, signIn } = useAuth()
  const location = useLocation()
  const [error, setError] = useState<string | null>(null)

  if (loading) return <Spinner label="Checking your session…" />

  if (user) {
    const from = (location.state as { from?: string } | null)?.from
    return <Navigate to={from ?? '/'} replace />
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4">
      <Card>
        <h1 className="text-xl font-semibold text-slate-900">
          Nirmaan <span className="text-brand-600">Files</span>
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Sign in with your <strong>@{CAMPUS_DOMAIN}</strong> account to see your projects.
        </p>

        <div className="mt-6 flex justify-center">
          <GoogleLogin
            // A hint for the account chooser only — the server independently
            // verifies the token and enforces the domain.
            hosted_domain={CAMPUS_DOMAIN}
            onSuccess={async (response) => {
              setError(null)
              if (!response.credential) {
                setError('Google did not return a credential. Please try again.')
                return
              }
              try {
                await signIn(response.credential)
              } catch (caught) {
                setError(
                  caught instanceof ApiError
                    ? caught.detail
                    : 'Could not sign in. Please try again.',
                )
              }
            }}
            onError={() => setError('Google sign-in was cancelled or failed.')}
          />
        </div>

        {error && (
          <div className="mt-4">
            <ErrorNote message={error} />
          </div>
        )}

        <p className="mt-6 text-xs text-slate-500">
          New here? Signing in creates your account, but a project lead still needs to add
          you to a project before you can see anything.
        </p>
      </Card>
    </div>
  )
}
