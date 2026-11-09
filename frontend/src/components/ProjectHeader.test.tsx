import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { EffectiveRole } from '@/api/types'
import { ProjectHeader } from '@/components/ProjectHeader'
import { makeProject } from '@/test/factories'
import { renderApp } from '@/test/render'

const auth = vi.hoisted(() => ({ role: null as EffectiveRole | null }))

vi.mock('@/auth/AuthContext', () => ({ useAuth: () => ({ roleIn: () => auth.role }) }))

const hrefOf = (name: string) => screen.getByRole('link', { name }).getAttribute('href')

function show(route = '/projects/shiksha') {
  renderApp(<ProjectHeader project={makeProject()} />, { route, path: '/projects/:slug' })
}

beforeEach(() => {
  auth.role = 'VOLUNTEER'
})

describe('ProjectHeader', () => {
  it('shows the project and the reader’s role', () => {
    show()
    expect(screen.getByRole('heading', { name: 'Shiksha' })).toBeInTheDocument()
    expect(screen.getByText('Volunteer')).toBeInTheDocument()
  })

  it('reads as read-only with no role this term', () => {
    auth.role = null
    show()
    expect(screen.getByText('Read only')).toBeInTheDocument()
  })

  it('links every section with no term in view', () => {
    show()
    expect(hrefOf('Timeline')).toBe('/projects/shiksha')
    expect(hrefOf('Attendance')).toBe('/projects/shiksha/attendance')
    expect(hrefOf('Knowledge')).toBe('/projects/shiksha/knowledge')
    expect(hrefOf('Resources')).toBe('/projects/shiksha/resources')
    expect(hrefOf('Reimbursements')).toBe('/projects/shiksha/reimbursements')
    expect(hrefOf('Archive')).toBe('/projects/shiksha/archive')
  })

  it('carries the viewed term across the per-term tabs only', () => {
    show('/projects/shiksha?semester=old')
    expect(hrefOf('Timeline')).toBe('/projects/shiksha?semester=old')
    expect(hrefOf('Attendance')).toBe('/projects/shiksha/attendance?semester=old')
    expect(hrefOf('Reimbursements')).toBe('/projects/shiksha/reimbursements?semester=old')
    expect(hrefOf('Knowledge')).toBe('/projects/shiksha/knowledge')
    expect(hrefOf('Resources')).toBe('/projects/shiksha/resources')
    expect(hrefOf('Archive')).toBe('/projects/shiksha/archive')
  })
})
