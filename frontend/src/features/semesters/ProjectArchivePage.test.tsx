import { screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { ArchiveTerm } from '@/api/types'
import { ProjectArchivePage } from '@/features/semesters/ProjectArchivePage'
import { makeArchiveTerm, makeProject, makeSemester, makeUser } from '@/test/factories'
import { renderApp, stubApi } from '@/test/render'

vi.mock('@/auth/AuthContext', () => ({ useAuth: () => ({ roleIn: () => null }) }))

const open = makeSemester({ id: 10, slug: 'open', name: 'First Semester' })
const old = makeSemester({
  id: 9,
  slug: 'old',
  name: 'Old Semester',
  starts_on: '2026-01-05',
  ends_on: '2026-05-20',
  is_current: false,
})

function show(terms: ArchiveTerm[]) {
  stubApi({
    'GET /api/projects/shiksha/': { body: makeProject() },
    'GET /api/projects/shiksha/archive/': { body: terms },
    'GET /api/semesters/current/': { body: open },
  })
  renderApp(<ProjectArchivePage />, {
    route: '/projects/shiksha/archive',
    path: '/projects/:slug/archive',
  })
}

async function card(name: RegExp) {
  const heading = await screen.findByRole('heading', { name })
  return within(heading.closest('li') as HTMLElement)
}

describe('ProjectArchivePage', () => {
  it('shows each term’s dates and totals', async () => {
    show([makeArchiveTerm({ semester: old, visits: 7, meetings: 4, member_count: 12 })])
    const term = await card(/Old Semester/)

    expect(term.getByText('5 Jan 2026 to 20 May 2026')).toBeInTheDocument()
    expect(term.getByText('7')).toBeInTheDocument()
    expect(term.getByText('4')).toBeInTheDocument()
    expect(term.getByText('12')).toBeInTheDocument()
  })

  it('links into that term’s timeline and attendance', async () => {
    show([makeArchiveTerm({ semester: old })])
    const term = await card(/Old Semester/)

    expect(term.getByRole('link', { name: 'Timeline' })).toHaveAttribute(
      'href',
      '/projects/shiksha?semester=old',
    )
    expect(term.getByRole('link', { name: 'Attendance' })).toHaveAttribute(
      'href',
      '/projects/shiksha/attendance?semester=old',
    )
  })

  it('marks only the term in progress as current', async () => {
    show([makeArchiveTerm({ semester: open }), makeArchiveTerm({ semester: old })])

    expect(await (await card(/First Semester/)).findByText('Current')).toBeInTheDocument()
    expect((await card(/Old Semester/)).queryByText('Current')).not.toBeInTheDocument()
  })

  it('names the leads, using the email when unnamed', async () => {
    show([
      makeArchiveTerm({
        semester: old,
        leads: [makeUser({ full_name: 'Priya Nair' }), makeUser({ full_name: '', email: 'n@x.in' })],
      }),
    ])
    const term = await card(/Old Semester/)
    expect(term.getByText('Led by Priya Nair, n@x.in')).toBeInTheDocument()
  })

  it('says when a term had no lead', async () => {
    show([makeArchiveTerm({ semester: old })])
    const term = await card(/Old Semester/)
    expect(term.getByText('No lead this semester.')).toBeInTheDocument()
  })

  it('explains an empty archive', async () => {
    show([])
    expect(await screen.findByText('No semesters yet')).toBeInTheDocument()
  })

  it('shows an archive that failed to load', async () => {
    stubApi({
      'GET /api/projects/shiksha/': { body: makeProject() },
      'GET /api/projects/shiksha/archive/': { status: 500, body: { detail: 'Archive broke.' } },
      'GET /api/semesters/current/': { body: open },
    })
    renderApp(<ProjectArchivePage />, {
      route: '/projects/shiksha/archive',
      path: '/projects/:slug/archive',
    })
    expect(await screen.findByRole('alert')).toHaveTextContent('Archive broke.')
  })
})
