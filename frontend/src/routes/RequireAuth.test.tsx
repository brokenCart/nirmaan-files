import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { User } from '@/api/types'
import { RequireAuth } from '@/routes/RequireAuth'
import { makeUser } from '@/test/factories'

const auth = vi.hoisted(() => ({ user: null as User | null, loading: false }))

vi.mock('@/auth/AuthContext', () => ({ useAuth: () => auth }))

function LoginProbe() {
  const location = useLocation()
  return <p>Login, from {(location.state as { from: string }).from}</p>
}

function renderGuarded() {
  render(
    <MemoryRouter initialEntries={['/projects/shiksha']}>
      <Routes>
        <Route path="/login" element={<LoginProbe />} />
        <Route
          path="/projects/shiksha"
          element={
            <RequireAuth>
              <p>Secret timeline</p>
            </RequireAuth>
          }
        />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  auth.user = null
  auth.loading = false
})

describe('RequireAuth', () => {
  it('waits for the session to restore rather than bouncing to login', () => {
    auth.loading = true
    renderGuarded()
    expect(screen.getByText('Restoring your session…')).toBeInTheDocument()
    expect(screen.queryByText(/Login/)).not.toBeInTheDocument()
  })

  it('sends a signed-out visitor to login, remembering where they were going', () => {
    renderGuarded()
    expect(screen.getByText('Login, from /projects/shiksha')).toBeInTheDocument()
    expect(screen.queryByText('Secret timeline')).not.toBeInTheDocument()
  })

  it('shows the page to a signed-in user', () => {
    auth.user = makeUser()
    renderGuarded()
    expect(screen.getByText('Secret timeline')).toBeInTheDocument()
  })
})
