import { createContext, use } from 'react'

import type { EffectiveRole, MembershipSummary, User } from '@/api/types'

export interface AuthState {
  user: User | null
  memberships: MembershipSummary[]
  /** True until the initial refresh-cookie exchange settles. */
  loading: boolean
  signIn: (credential: string) => Promise<void>
  signOut: () => Promise<void>
  /** The user's role in a project, or `EXEC` for committee members. */
  roleIn: (projectSlug: string) => EffectiveRole | null
}

export const AuthContext = createContext<AuthState | null>(null)

export function useAuth(): AuthState {
  const context = use(AuthContext)
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>.')
  return context
}
