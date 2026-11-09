import { act, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/client'
import type { User } from '@/api/types'
import { LoginPage } from '@/features/auth/LoginPage'
import { makeUser } from '@/test/factories'
import { currentLocation, renderApp } from '@/test/render'

interface GoogleProps {
  hosted_domain: string
  onSuccess: (response: { credential?: string }) => Promise<void>
  onError: () => void
}

const google = vi.hoisted(() => ({ props: undefined as unknown }))
const auth = vi.hoisted(() => ({
  user: null as User | null,
  loading: false,
  signIn: undefined as unknown,
}))

vi.mock('@react-oauth/google', () => ({
  GoogleLogin: (props: unknown) => {
    google.props = props
    return 'google button'
  },
}))
vi.mock('@/auth/AuthContext', () => ({ useAuth: () => auth }))

const button = () => google.props as GoogleProps

function show(from?: string) {
  renderApp(<LoginPage />, {
    route: { pathname: '/login', state: from ? { from } : null },
    path: '/login',
  })
}

beforeEach(() => {
  auth.user = null
  auth.loading = false
  auth.signIn = vi.fn(async () => undefined)
})

describe('LoginPage', () => {
  it('waits while the session is being checked', () => {
    auth.loading = true
    show()
    expect(screen.getByText('Checking your session…')).toBeInTheDocument()
    expect(screen.queryByText('google button')).not.toBeInTheDocument()
  })

  it('names the campus domain and hints it to Google', () => {
    show()
    expect(screen.getByText('@pilani.bits-pilani.ac.in')).toBeInTheDocument()
    expect(button().hosted_domain).toBe('pilani.bits-pilani.ac.in')
  })

  it('sends a signed-in user back where they were going', () => {
    auth.user = makeUser()
    show('/projects/shiksha/resources')
    expect(currentLocation()).toBe('/projects/shiksha/resources')
  })

  it('sends a signed-in user home by default', () => {
    auth.user = makeUser()
    show()
    expect(currentLocation()).toBe('/')
  })

  it('exchanges the Google credential', async () => {
    show()
    await act(() => button().onSuccess({ credential: 'abc' }))
    expect(auth.signIn).toHaveBeenCalledWith('abc')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows why the server refused', async () => {
    auth.signIn = vi.fn(async () => {
      throw new ApiError(403, 'Use your campus account.')
    })
    show()
    await act(() => button().onSuccess({ credential: 'abc' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Use your campus account.')
  })

  it('falls back to a plain message when the request never landed', async () => {
    auth.signIn = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    show()
    await act(() => button().onSuccess({ credential: 'abc' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t sign in. Try again.')
  })

  it('does not call the server without a credential', async () => {
    show()
    await act(() => button().onSuccess({}))
    expect(auth.signIn).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('Google sign-in didn’t complete.')
  })

  it('says so when the Google popup is cancelled', () => {
    show()
    act(() => button().onError())
    expect(screen.getByRole('alert')).toHaveTextContent('Google sign-in was cancelled.')
  })

  it('clears an old error on the next attempt', async () => {
    show()
    act(() => button().onError())
    await act(() => button().onSuccess({ credential: 'abc' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
