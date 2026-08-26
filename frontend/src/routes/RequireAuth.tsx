import { Navigate, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'

import { useAuth } from '@/auth/AuthContext'
import { Spinner } from '@/components/ui'

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()

  // Wait for the boot-time refresh to settle, otherwise every reload would
  // bounce a signed-in user to the login screen.
  if (loading) return <Spinner label="Restoring your session…" />

  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />

  return <>{children}</>
}
