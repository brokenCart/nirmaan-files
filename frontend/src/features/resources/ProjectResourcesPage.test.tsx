import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { EffectiveRole, Resource, User } from '@/api/types'
import { ProjectResourcesPage } from '@/features/resources/ProjectResourcesPage'
import { makeProject, makeResource, makeUser } from '@/test/factories'
import { renderApp, stubApi } from '@/test/render'
import type { Reply } from '@/test/render'

const auth = vi.hoisted(() => ({
  role: null as EffectiveRole | null,
  user: undefined as User | undefined,
}))

vi.mock('@/auth/AuthContext', () => ({
  useAuth: () => ({ user: auth.user, roleIn: () => auth.role }),
}))

const me = makeUser({ id: 1, full_name: 'Aarav Sharma' })
const someoneElse = makeUser({ id: 2, full_name: 'Priya Nair' })

const folder = makeResource({
  id: 400,
  title: 'Drive folder',
  kind: 'FOLDER',
  url: 'https://www.drive.google.com/x',
  description: 'Everything lives here.',
  added_by: someoneElse,
})
const sheet = makeResource({
  id: 401,
  title: 'Beneficiary list',
  kind: 'SHEET',
  url: 'https://docs.google.com/y',
  description: '',
  added_by: me,
})

function show(rows: Resource[] = [folder], remove: Reply = { status: 204 }) {
  const calls = stubApi({
    'GET /api/projects/shiksha/': { body: makeProject() },
    'GET /api/resources/': { body: rows },
    'POST /api/resources/': { status: 201, body: makeResource() },
    'PATCH /api/resources/400/': { body: makeResource() },
    'DELETE /api/resources/400/': remove,
  })
  renderApp(<ProjectResourcesPage />, {
    route: '/projects/shiksha/resources',
    path: '/projects/:slug/resources',
  })
  return calls
}

const linkLoaded = (name: string | RegExp = /Drive folder/) => screen.findByRole('link', { name })
const search = () => screen.getByRole('searchbox', { name: 'Search links' })
const removeFolder = () =>
  screen.getByRole('button', { name: 'Remove “Drive folder” from the resources' })

beforeEach(() => {
  auth.user = me
  auth.role = 'VOLUNTEER'
})

describe('ProjectResourcesPage shelf', () => {
  it('opens each link in a new tab without handing over the opener', async () => {
    show()
    const link = await linkLoaded()
    expect(link).toHaveAttribute('href', 'https://www.drive.google.com/x')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('shows the kind, description, and host without www', async () => {
    show()
    await linkLoaded()
    expect(screen.getByText('Everything lives here.')).toBeInTheDocument()
    expect(screen.getByText('drive.google.com')).toBeInTheDocument()
    expect(screen.getByText(/added by Priya Nair/)).toBeInTheDocument()
  })

  it('still renders a row whose URL cannot be parsed', async () => {
    show([makeResource({ title: 'Old link', url: 'not a url', added_by: someoneElse })])
    await linkLoaded(/Old link/)
    expect(screen.getByText('Added by Priya Nair')).toBeInTheDocument()
  })

  it('treats a row with no kind as a plain link', async () => {
    show([makeResource({ title: 'Mystery', kind: undefined })])
    await linkLoaded(/Mystery/)
    expect(screen.getByText('Link')).toBeInTheDocument()
  })

  it('invites a member to add the first link', async () => {
    show([])
    expect(await screen.findByText('No links yet')).toBeInTheDocument()
    expect(screen.getByText('Add the project’s Drive folder, plans or forms.')).toBeInTheDocument()
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
  })

  it('tells a former member nobody has added one', async () => {
    auth.role = null
    show([])
    expect(await screen.findByText('No one has added a link yet.')).toBeInTheDocument()
  })

  it('shows a shelf that failed to load', async () => {
    stubApi({
      'GET /api/projects/shiksha/': { body: makeProject() },
      'GET /api/resources/': { status: 500, body: { detail: 'Shelf broke.' } },
    })
    renderApp(<ProjectResourcesPage />, {
      route: '/projects/shiksha/resources',
      path: '/projects/:slug/resources',
    })
    expect(await screen.findByRole('alert')).toHaveTextContent('Shelf broke.')
  })
})

describe('ProjectResourcesPage search', () => {
  it.each([
    ['title', 'beneficiary'],
    ['kind label', 'spreadsheet'],
    ['url', 'docs.google'],
    ['who added it', 'aarav'],
  ])('narrows by %s without asking the server', async (_field, term) => {
    const calls = show([folder, sheet])
    await linkLoaded()
    const before = calls.length

    await userEvent.type(search(), term)

    await waitFor(() =>
      expect(screen.queryByRole('link', { name: /Drive folder/ })).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('link', { name: /Beneficiary list/ })).toBeInTheDocument()
    expect(calls).toHaveLength(before)
  })

  it('says when nothing matches', async () => {
    show([folder])
    await linkLoaded()

    await userEvent.type(search(), 'zzz')

    expect(await screen.findByText('No links match')).toBeInTheDocument()
  })
})

describe('ProjectResourcesPage permissions', () => {
  it('lets a member add a link', async () => {
    show()
    await linkLoaded()
    expect(screen.getByRole('button', { name: 'Add link' })).toBeInTheDocument()
  })

  it('leaves a former member reading only, and says so', async () => {
    auth.role = null
    show([makeResource({ title: 'Drive folder', added_by: me })])
    expect(await screen.findByText(/you can open links but not add or edit/)).toBeInTheDocument()
    await linkLoaded()
    expect(screen.queryByRole('button', { name: 'Add link' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
  })

  it('stops a volunteer changing someone else’s link', async () => {
    show()
    await linkLoaded()
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
  })

  it('lets a volunteer change their own', async () => {
    show([sheet])
    await linkLoaded(/Beneficiary list/)
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
  })

  it.each(['LEAD', 'FINANCE_LEAD'] as const)('lets %s change anyone’s', async (role) => {
    auth.role = role
    show()
    await linkLoaded()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    expect(removeFolder()).toBeInTheDocument()
  })

  it('honours exec even when reported as a volunteer', async () => {
    auth.user = makeUser({ id: 1, is_exec: true })
    show()
    await linkLoaded()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
  })
})

describe('ProjectResourcesPage changes', () => {
  beforeEach(() => {
    auth.role = 'LEAD'
  })

  it('keeps one editor open at a time', async () => {
    show()
    await linkLoaded()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByRole('heading', { name: 'Edit link' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add link' }))
    expect(screen.queryByRole('heading', { name: 'Edit link' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'New link' })).toBeInTheDocument()
  })

  it('closes the editor once saved', async () => {
    show()
    await linkLoaded()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Edit link' })).not.toBeInTheDocument(),
    )
  })

  it('closes the new link form once added', async () => {
    show()
    await linkLoaded()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Add link' }))
    await user.type(screen.getByRole('textbox', { name: /^name/i }), 'Plans')
    await user.type(screen.getByRole('textbox', { name: /^link/i }), 'https://x.in/plans')
    await user.click(screen.getByRole('button', { name: 'Add link' }))

    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'New link' })).not.toBeInTheDocument(),
    )
  })

  it('confirms, reassuring that Drive is untouched, then removes', async () => {
    const calls = show()
    await linkLoaded()
    const user = userEvent.setup()

    await user.click(removeFolder())
    expect(screen.getByText('Remove this link? The file stays in Drive.')).toBeInTheDocument()
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Remove' }))

    await waitFor(() => expect(calls.some((call) => call.method === 'DELETE')).toBe(true))
  })

  it('backs out', async () => {
    const calls = show()
    await linkLoaded()
    const user = userEvent.setup()

    await user.click(removeFolder())
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(removeFolder()).toBeInTheDocument()
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false)
  })

  it('shows a refusal', async () => {
    show([folder], { status: 403, body: { detail: 'Not allowed.' } })
    await linkLoaded()
    const user = userEvent.setup()

    await user.click(removeFolder())
    await user.click(screen.getByRole('button', { name: 'Remove' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Not allowed.')
  })
})
