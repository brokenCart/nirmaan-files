import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { Membership, Semester } from '@/api/types'
import { ProjectMembersPanel } from '@/features/projects/ProjectMembersPanel'
import { makeMembership, makeProject, makeSemester, makeUser } from '@/test/factories'
import { renderApp, stubApi } from '@/test/render'

vi.mock('@/auth/AuthContext', () => ({ useAuth: () => ({ user: { is_exec: false } }) }))

const member = (id: number, full_name: string, role: Membership['role'], signedIn = true) =>
  makeMembership({
    id,
    role,
    user: makeUser({ id, full_name, email: `m${id}@x.in`, has_signed_in: signedIn }),
  })

const roster = [
  member(1, 'Zoya Volunteer', 'VOLUNTEER'),
  member(2, 'Aarav Volunteer', 'VOLUNTEER'),
  member(3, 'Meera Finance', 'FINANCE_LEAD'),
  member(4, 'Nikhil Lead', 'LEAD'),
]

const term: Semester = makeSemester({ name: 'First Semester' })

function show({
  members = roster,
  manageableTerm,
  canRemove,
}: {
  members?: Membership[]
  manageableTerm?: Semester
  canRemove?: (member: Membership) => boolean
} = {}) {
  renderApp(
    <ProjectMembersPanel
      members={members}
      project={makeProject()}
      manageableTerm={manageableTerm}
      canRemove={canRemove}
    />,
  )
}

const shownNames = () =>
  screen
    .getAllByRole('listitem')
    .map((row) => row.querySelector('span[title]')?.getAttribute('title'))

const searchBox = () => screen.getByRole('searchbox', { name: 'Search members' })

describe('ProjectMembersPanel roster', () => {
  it('orders by seniority, then name', () => {
    show()
    expect(shownNames()).toEqual([
      'Nikhil Lead',
      'Meera Finance',
      'Aarav Volunteer',
      'Zoya Volunteer',
    ])
  })

  it('counts the roster', () => {
    show()
    expect(screen.getByText('4')).toBeInTheDocument()
  })

  it('falls back to the email for someone not yet signed in', () => {
    show({ members: [makeMembership({ user: makeUser({ full_name: '', email: 'new@x.in' }) })] })
    expect(screen.getByText('new@x.in')).toBeInTheDocument()
  })

  it('explains an empty term', () => {
    show({ members: [] })
    expect(screen.getByText('No members this semester yet.')).toBeInTheDocument()
  })
})

describe('ProjectMembersPanel search', () => {
  it('narrows by name and reports how many', async () => {
    show()
    await userEvent.type(searchBox(), 'zoya')
    expect(await screen.findByText('1 of 4')).toBeInTheDocument()
    expect(shownNames()).toEqual(['Zoya Volunteer'])
  })

  it('matches by role label and email', async () => {
    show()
    await userEvent.type(searchBox(), 'finance lead')
    await waitFor(() => expect(shownNames()).toEqual(['Meera Finance']))

    await userEvent.clear(searchBox())
    await userEvent.type(searchBox(), 'm4@x')
    await waitFor(() => expect(shownNames()).toEqual(['Nikhil Lead']))
  })

  it('says when nothing matches', async () => {
    show()
    await userEvent.type(searchBox(), 'nobody')
    expect(await screen.findByText('No members match “nobody”.')).toBeInTheDocument()
  })

  it('clears', async () => {
    show()
    await userEvent.type(searchBox(), 'zoya')
    await userEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    await waitFor(() => expect(shownNames()).toHaveLength(4))
    expect(searchBox()).toHaveValue('')
  })
})

describe('ProjectMembersPanel adding', () => {
  it('offers nothing when the caller cannot manage the term', () => {
    show()
    expect(screen.queryByRole('button', { name: 'Add member' })).not.toBeInTheDocument()
  })

  it('opens the form and closes it again', async () => {
    show({ manageableTerm: term })

    await userEvent.click(screen.getByRole('button', { name: 'Add member' }))
    expect(screen.getByRole('textbox', { name: /^email/i })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('textbox', { name: /^email/i })).not.toBeInTheDocument()
  })
})

describe('ProjectMembersPanel removing', () => {
  const removeZoya = () =>
    screen.getByRole('button', { name: 'Remove Zoya Volunteer from this semester' })

  it('shows no remove control by default', () => {
    show()
    expect(screen.queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument()
  })

  it('asks per row', () => {
    show({ canRemove: (row) => row.role === 'VOLUNTEER' })
    expect(removeZoya()).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Remove Nikhil Lead from this semester' }),
    ).not.toBeInTheDocument()
  })

  it('confirms, names the term, then removes', async () => {
    const calls = stubApi({ 'DELETE /api/memberships/1/': { status: 204 } })
    show({ manageableTerm: term, canRemove: () => true })

    await userEvent.click(removeZoya())
    expect(screen.getByText(/Remove from First Semester\?/)).toBeInTheDocument()
    expect(calls).toHaveLength(0)

    await userEvent.click(screen.getByRole('button', { name: 'Remove' }))

    await waitFor(() => expect(calls.map((call) => call.method)).toEqual(['DELETE']))
    await waitFor(() =>
      expect(screen.queryByText(/Remove from First Semester\?/)).not.toBeInTheDocument(),
    )
  })

  it('warns that a never-signed-in account may go too', async () => {
    show({
      members: [member(1, 'Zoya Volunteer', 'VOLUNTEER', false)],
      manageableTerm: term,
      canRemove: () => true,
    })

    await userEvent.click(removeZoya())

    expect(screen.getByText(/unused account may be deleted too/)).toBeInTheDocument()
  })

  it('backs out without removing', async () => {
    const calls = stubApi({})
    show({ manageableTerm: term, canRemove: () => true })

    await userEvent.click(removeZoya())
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(removeZoya()).toBeInTheDocument()
    expect(calls).toHaveLength(0)
  })

  it('shows a refusal and stays open', async () => {
    stubApi({ 'DELETE /api/memberships/1/': { status: 403, body: { detail: 'Not allowed.' } } })
    show({ manageableTerm: term, canRemove: () => true })

    await userEvent.click(removeZoya())
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Not allowed.')
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument()
  })
})
