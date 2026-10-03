import { GoogleLogin } from '@react-oauth/google'
import { useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'

import { ApiError } from '@/api/client'
import { useAuth } from '@/auth/AuthContext'
import { NirmaanLogo } from '@/components/Logo'
import { ErrorNote, Spinner } from '@/components/ui'

const CAMPUS_DOMAIN = 'pilani.bits-pilani.ac.in'

// The logo's four panels, named for the verticals they stand for.
const VERTICALS = [
  { name: 'Education', className: 'bg-nirmaan-blue text-white' },
  { name: 'Livelihood', className: 'bg-nirmaan-gold text-ink' },
  { name: 'Women’s empowerment', className: 'bg-nirmaan-red text-white' },
  { name: 'Agriculture', className: 'bg-nirmaan-green text-ink' },
]

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
    <div className="grid min-h-dvh bg-surface lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      {/* The four verticals as a colour field: the one image the app has. */}
      <div
        className="grid grid-cols-2 grid-rows-[5.5rem_5.5rem] sm:grid-rows-[9rem_9rem] lg:sticky lg:top-0 lg:h-dvh lg:grid-rows-2"
        aria-hidden
      >
        {VERTICALS.map((vertical) => (
          <div key={vertical.name} className={`flex items-end p-4 sm:p-6 ${vertical.className}`}>
            <span className="text-base leading-tight font-bold sm:text-xl lg:text-2xl">
              {vertical.name}
            </span>
          </div>
        ))}
      </div>

      <div className="flex flex-col justify-center px-6 py-12 sm:px-12 lg:px-16">
        <div className="w-full max-w-sm">
          <NirmaanLogo imgClassName="h-24 sm:h-28" className="-ml-3" />

          <h1 className="mt-6 text-4xl leading-[1.05] font-bold tracking-[-0.02em] text-navy sm:text-5xl">
            Nirmaan Files
          </h1>
          <p className="mt-4 text-ink-soft">
            Visit logs, meeting notes, project pages and expense claims. Sign in with your{' '}
            <strong className="font-semibold text-ink">@{CAMPUS_DOMAIN}</strong> account.
          </p>

          <div className="mt-8">
            <GoogleLogin
              // A hint for the account chooser only — the server independently
              // verifies the token and enforces the domain.
              hosted_domain={CAMPUS_DOMAIN}
              shape="rectangular"
              size="large"
              onSuccess={async (response) => {
                setError(null)
                if (!response.credential) {
                  setError('Google sign-in didn’t complete. Try again.')
                  return
                }
                try {
                  await signIn(response.credential)
                } catch (caught) {
                  setError(
                    caught instanceof ApiError ? caught.detail : 'Couldn’t sign in. Try again.',
                  )
                }
              }}
              onError={() => setError('Google sign-in was cancelled.')}
            />
          </div>

          {error && (
            <div className="mt-4">
              <ErrorNote message={error} />
            </div>
          )}

          <p className="mt-8 border-t border-line pt-4 text-sm text-ink-mute">
            New here? Sign in, then ask a project lead to add you to their project.
          </p>
        </div>
      </div>
    </div>
  )
}
