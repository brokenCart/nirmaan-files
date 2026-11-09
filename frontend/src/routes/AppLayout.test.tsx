import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { User } from '@/api/types'
import { AppLayout } from '@/routes/AppLayout'
import { makeUser } from '@/test/factories'

const auth = vi.hoisted(() => ({ user: null as User | null, signOut: undefined as unknown }))

vi.mock('@/auth/AuthContext', () => ({ useAuth: () => auth }))

function show() {
  render(
    <MemoryRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<p>page content</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  auth.user = makeUser({ full_name: 'Aarav Sharma' })
  auth.signOut = vi.fn(async () => undefined)
})

describe('AppLayout', () => {
  it('renders the current page inside the frame', () => {
    show()
    expect(screen.getByRole('main')).toHaveTextContent('page content')
  })

  it('links the logo home', () => {
    show()
    expect(screen.getByRole('link', { name: /Nirmaan/ })).toHaveAttribute('href', '/')
  })

  it('shows the user’s name and initials', () => {
    show()
    expect(screen.getByText('AS')).toBeInTheDocument()
    expect(screen.getByText('Aarav Sharma')).toBeInTheDocument()
  })

  it('takes at most two initials, skipping punctuation', () => {
    auth.user = makeUser({ full_name: 'priya-nair rao' })
    show()
    expect(screen.getByText('PN')).toBeInTheDocument()
  })

  it('falls back to the email for an unnamed account', () => {
    auth.user = makeUser({ full_name: '', email: 'new@pilani.bits-pilani.ac.in' })
    show()
    expect(screen.getByText('new@pilani.bits-pilani.ac.in')).toBeInTheDocument()
  })

  it('signs out', async () => {
    show()
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(auth.signOut).toHaveBeenCalledOnce()
  })
})
