import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api, setAccessToken } from '@/api/client'
import type { MembershipSummary, User } from '@/api/types'
import { useAuth } from '@/auth/AuthContext'
import { AuthProvider } from '@/auth/AuthProvider'
import { makeUser } from '@/test/factories'
import { renderApp, stubApi } from '@/test/render'

const SHIKSHA_LEAD: MembershipSummary = {
  project_id: 100,
  project_slug: 'shiksha',
  project_name: 'Shiksha',
  role: 'LEAD',
}

const session = (user: User = makeUser(), memberships: MembershipSummary[] = []) => ({
  access: 'token',
  user,
  memberships,
})

function Probe() {
  const { user, loading, roleIn, signIn, signOut } = useAuth()
  return (
    <div>
      <p>loading: {String(loading)}</p>
      <p>user: {user?.full_name ?? 'none'}</p>
      <p>shiksha: {String(roleIn('shiksha'))}</p>
      <p>aarogya: {String(roleIn('aarogya'))}</p>
      <button onClick={() => void signIn('google-credential')}>sign in</button>
      <button onClick={() => void signOut()}>sign out</button>
    </div>
  )
}

function show() {
  return renderApp(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  )
}

const restored = () => screen.findByText('loading: false')

beforeEach(() => setAccessToken(null))

describe('AuthProvider', () => {
  it('reports loading until the refresh cookie has been tried', async () => {
    stubApi({ 'POST /api/auth/refresh/': { status: 401, body: {} } })
    show()
    expect(screen.getByText('loading: true')).toBeInTheDocument()
    await restored()
  })

  it('restores a session from the refresh cookie', async () => {
    stubApi({ 'POST /api/auth/refresh/': { body: session() } })
    show()
    await restored()
    expect(screen.getByText('user: Aarav Sharma')).toBeInTheDocument()
  })

  it('stays signed out when there is nothing to restore', async () => {
    stubApi({ 'POST /api/auth/refresh/': { status: 401, body: {} } })
    show()
    await restored()
    expect(screen.getByText('user: none')).toBeInTheDocument()
  })

  it('signs in with the Google credential and clears the old cache', async () => {
    const calls = stubApi({
      'POST /api/auth/refresh/': { status: 401, body: {} },
      'POST /api/auth/google/': { body: session(makeUser({ full_name: 'Priya Nair' })) },
    })
    const { client } = show()
    await restored()
    client.setQueryData(['projects'], 'someone else’s')

    await userEvent.click(screen.getByRole('button', { name: 'sign in' }))

    expect(await screen.findByText('user: Priya Nair')).toBeInTheDocument()
    expect(calls.find((call) => call.path === '/api/auth/google/')?.body).toEqual({
      credential: 'google-credential',
    })
    expect(client.getQueryData(['projects'])).toBeUndefined()
  })

  it('signs out, forgetting the user and the cache', async () => {
    const calls = stubApi({
      'POST /api/auth/refresh/': { body: session(makeUser(), [SHIKSHA_LEAD]) },
      'POST /api/auth/logout/': { status: 204 },
    })
    const { client } = show()
    await restored()
    client.setQueryData(['projects'], 'cached')

    await userEvent.click(screen.getByRole('button', { name: 'sign out' }))

    expect(await screen.findByText('user: none')).toBeInTheDocument()
    expect(screen.getByText('shiksha: null')).toBeInTheDocument()
    expect(calls.some((call) => call.path === '/api/auth/logout/')).toBe(true)
    expect(client.getQueryData(['projects'])).toBeUndefined()
  })

  it('clears the screen when a session dies mid-use', async () => {
    stubApi({
      'POST /api/auth/refresh/': [{ body: session() }, { status: 401, body: {} }],
      'GET /api/x/': { status: 401, body: { detail: 'Expired.' } },
    })
    const { client } = show()
    await restored()
    client.setQueryData(['projects'], 'cached')

    await api.get('/api/x/').catch(() => undefined)

    expect(await screen.findByText('user: none')).toBeInTheDocument()
    expect(client.getQueryData(['projects'])).toBeUndefined()
  })

  describe('roleIn', () => {
    it('answers from the membership on that project', async () => {
      stubApi({ 'POST /api/auth/refresh/': { body: session(makeUser(), [SHIKSHA_LEAD]) } })
      show()
      await restored()
      expect(screen.getByText('shiksha: LEAD')).toBeInTheDocument()
      expect(screen.getByText('aarogya: null')).toBeInTheDocument()
    })

    it('reports exec on a project they hold no membership in', async () => {
      stubApi({
        'POST /api/auth/refresh/': { body: session(makeUser({ is_exec: true }), []) },
      })
      show()
      await restored()
      expect(screen.getByText('aarogya: EXEC')).toBeInTheDocument()
    })

    it('prefers a membership over the committee marker', async () => {
      stubApi({
        'POST /api/auth/refresh/': {
          body: session(makeUser({ is_exec: true }), [{ ...SHIKSHA_LEAD, role: 'VOLUNTEER' }]),
        },
      })
      show()
      await restored()
      expect(screen.getByText('shiksha: VOLUNTEER')).toBeInTheDocument()
    })
  })
})

describe('useAuth', () => {
  it('refuses to run outside the provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(() => render(<Probe />)).toThrow('useAuth must be used inside <AuthProvider>.')
  })
})
