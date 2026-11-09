import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { User } from '@/api/types'
import { App } from '@/App'
import { makeUser } from '@/test/factories'

const auth = vi.hoisted(() => ({
  user: null as User | null,
  loading: false,
  signOut: async () => undefined,
}))

vi.mock('@/auth/AuthContext', () => ({ useAuth: () => auth }))

vi.mock('@/features/auth/LoginPage', () => ({ LoginPage: () => 'login page' }))
vi.mock('@/features/projects/ProjectListPage', () => ({ ProjectListPage: () => 'project list' }))
vi.mock('@/features/logs/ProjectTimelinePage', () => ({
  ProjectTimelinePage: () => 'timeline page',
}))
vi.mock('@/features/attendance/ProjectAttendancePage', () => ({
  ProjectAttendancePage: () => 'attendance page',
}))
vi.mock('@/features/semesters/ProjectArchivePage', () => ({
  ProjectArchivePage: () => 'archive page',
}))
vi.mock('@/features/resources/ProjectResourcesPage', () => ({
  ProjectResourcesPage: () => 'resources page',
}))
vi.mock('@/features/reimbursements/ProjectReimbursementsPage', () => ({
  ProjectReimbursementsPage: () => 'reimbursements page',
}))
vi.mock('@/features/knowledge/ProjectKnowledgePage', () => ({
  ProjectKnowledgePage: () => 'knowledge page',
}))
vi.mock('@/features/knowledge/ArticlePage', () => ({ ArticlePage: () => 'article page' }))

function visit(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  auth.user = makeUser()
  auth.loading = false
})

describe('App routes', () => {
  it.each([
    ['/', 'project list'],
    ['/projects/shiksha', 'timeline page'],
    ['/projects/shiksha/attendance', 'attendance page'],
    ['/projects/shiksha/archive', 'archive page'],
    ['/projects/shiksha/resources', 'resources page'],
    ['/projects/shiksha/reimbursements', 'reimbursements page'],
    ['/projects/shiksha/knowledge', 'knowledge page'],
    ['/projects/shiksha/knowledge/12', 'article page'],
  ])('%s shows the %s', (path, page) => {
    visit(path)
    expect(screen.getByText(page)).toBeInTheDocument()
  })

  it('sends an unknown address home', () => {
    visit('/nowhere')
    expect(screen.getByText('project list')).toBeInTheDocument()
  })

  it.each(['/', '/projects/shiksha', '/projects/shiksha/reimbursements'])(
    'keeps %s behind sign-in',
    (path) => {
      auth.user = null
      visit(path)
      expect(screen.getByText('login page')).toBeInTheDocument()
    },
  )

  it('leaves the login page open to everyone', () => {
    auth.user = null
    visit('/login')
    expect(screen.getByText('login page')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument()
  })
})
