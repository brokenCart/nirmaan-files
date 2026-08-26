import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import {
  loginWithGoogle,
  logout as apiLogout,
  onSessionEnded,
  restoreSession,
} from '@/api/client'
import type { EffectiveRole, MembershipSummary, User } from '@/api/types'

import { AuthContext, type AuthState } from './AuthContext'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [memberships, setMemberships] = useState<MembershipSummary[]>([])
  const [loading, setLoading] = useState(true)
  const queryClient = useQueryClient()

  // The access token lives in memory, so a reload always starts signed out
  // until the refresh cookie is exchanged.
  useEffect(() => {
    let cancelled = false

    restoreSession()
      .then((session) => {
        if (cancelled || !session) return
        setUser(session.user)
        setMemberships(session.memberships)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  // A refresh that fails mid-session (expired or revoked) has to clear the UI,
  // not leave a stale user rendered against a dead token.
  useEffect(
    () =>
      onSessionEnded(() => {
        setUser(null)
        setMemberships([])
        queryClient.clear()
      }),
    [queryClient],
  )

  const signIn = useCallback(
    async (credential: string) => {
      const session = await loginWithGoogle(credential)
      setUser(session.user)
      setMemberships(session.memberships)
      queryClient.clear()
    },
    [queryClient],
  )

  const signOut = useCallback(async () => {
    await apiLogout()
    setUser(null)
    setMemberships([])
    queryClient.clear()
  }, [queryClient])

  const roleIn = useCallback(
    (projectSlug: string): EffectiveRole | null => {
      const membership = memberships.find((m) => m.project_slug === projectSlug)
      if (membership) return membership.role
      // Exec holds no memberships but can see everything.
      return user?.is_exec ? 'EXEC' : null
    },
    [memberships, user],
  )

  const value = useMemo<AuthState>(
    () => ({ user, memberships, loading, signIn, signOut, roleIn }),
    [user, memberships, loading, signIn, signOut, roleIn],
  )

  return <AuthContext value={value}>{children}</AuthContext>
}
