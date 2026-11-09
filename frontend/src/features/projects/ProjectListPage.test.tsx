import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { User } from '@/api/types'
import { ProjectListPage } from '@/features/projects/ProjectListPage'
import { makeProject, makeUser } from '@/test/factories'
import { paginated, renderApp, stubApi } from '@/test/render'

const auth = vi.hoisted(() => ({ user: null as User | null }))

vi.mock('@/auth/AuthContext', () => ({ useAuth: () => auth }))

beforeEach(() => {
  auth.user = makeUser()
})

describe('ProjectListPage', () => {
  it('links each project and shows the reader’s role', async () => {
    stubApi({ 'GET /api/projects/': { body: paginated([makeProject({ my_role: 'LEAD' })]) } })
    renderApp(<ProjectListPage />)

    const link = await screen.findByRole('link', { name: /Shiksha/ })
    expect(link).toHaveAttribute('href', '/projects/shiksha')
    expect(screen.getByText('Project Lead')).toBeInTheDocument()
  })

  it('marks a project from a past membership read-only', async () => {
    stubApi({ 'GET /api/projects/': { body: paginated([makeProject({ my_role: null })]) } })
    renderApp(<ProjectListPage />)
    expect(await screen.findByText('Read only')).toBeInTheDocument()
  })

  it.each([
    [1, '1 member'],
    [3, '3 members'],
  ])('counts %d as “%s”', async (member_count, label) => {
    stubApi({ 'GET /api/projects/': { body: paginated([makeProject({ member_count })]) } })
    renderApp(<ProjectListPage />)
    expect(await screen.findByText(label)).toBeInTheDocument()
  })

  it('tells a volunteer with no projects who to ask', async () => {
    stubApi({ 'GET /api/projects/': { body: paginated([]) } })
    renderApp(<ProjectListPage />)
    expect(await screen.findByText('No projects yet')).toBeInTheDocument()
    expect(screen.getByText('Ask a project lead to add you to their project.')).toBeInTheDocument()
  })

  it('points exec at the admin when there are none', async () => {
    auth.user = makeUser({ is_exec: true })
    stubApi({ 'GET /api/projects/': { body: paginated([]) } })
    renderApp(<ProjectListPage />)
    expect(await screen.findByText('Create one in the Django admin.')).toBeInTheDocument()
  })

  it('tells exec the list is everything', async () => {
    auth.user = makeUser({ is_exec: true })
    stubApi({ 'GET /api/projects/': { body: paginated([makeProject()]) } })
    renderApp(<ProjectListPage />)
    expect(await screen.findByText('All Nirmaan projects.')).toBeInTheDocument()
  })

  it('shows a failed load', async () => {
    stubApi({ 'GET /api/projects/': { status: 500, body: { detail: 'Server trouble.' } } })
    renderApp(<ProjectListPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Server trouble.')
  })
})
