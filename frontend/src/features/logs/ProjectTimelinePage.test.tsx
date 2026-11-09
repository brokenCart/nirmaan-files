import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { DailyLog, EffectiveRole, Membership, User } from '@/api/types'
import { ProjectTimelinePage } from '@/features/logs/ProjectTimelinePage'
import {
  makeLog,
  makeLogImage,
  makeMembership,
  makeProject,
  makeSemester,
  makeUser,
} from '@/test/factories'
import { currentLocation, paginated, renderApp, stubApi } from '@/test/render'
import type { Reply } from '@/test/render'

const auth = vi.hoisted(() => ({
  role: null as EffectiveRole | null,
  user: undefined as User | undefined,
}))

vi.mock('@/auth/AuthContext', () => ({
  useAuth: () => ({ user: auth.user, roleIn: () => auth.role, loading: false }),
}))

const me = makeUser({ id: 1, full_name: 'Aarav Sharma' })
const someoneElse = makeUser({ id: 2, full_name: 'Priya Nair' })
const open = makeSemester({ id: 10 })

async function showTimeline(logs: DailyLog[]) {
  stubApi({
    'GET /api/projects/shiksha/': { body: makeProject() },
    'GET /api/semesters/': { body: { count: 1, next: null, previous: null, results: [open] } },
    'GET /api/semesters/current/': { body: open },
    'GET /api/memberships/': { body: { count: 0, next: null, previous: null, results: [] } },
    'GET /api/logs/': { body: { count: logs.length, next: null, previous: null, results: logs } },
  })
  renderApp(<ProjectTimelinePage />, { route: '/projects/shiksha', path: '/projects/:slug' })
  // The term loads separately from the feed, and the buttons depend on it.
  await screen.findByRole('heading', { name: 'Saturday session' })
  await screen.findByRole('button', { name: /Copy/ })
}

beforeEach(() => {
  auth.user = me
  auth.role = 'VOLUNTEER'
})

describe('ProjectTimelinePage', () => {
  it('states the hours alongside who was present', async () => {
    await showTimeline([makeLog({ hours: 1.5, attendees: [me, someoneElse] })])
    expect(screen.getByText(/2 present for 1\.5 hours/)).toBeInTheDocument()
  })

  it('shows an entry’s photos, each linking to the full image', async () => {
    const image = makeLogImage()
    await showTimeline([makeLog({ title: 'Saturday session', images: [image] })])

    const photo = await screen.findByRole('img', { name: 'Photo 1 from Saturday session' })
    expect(photo).toHaveAttribute('src', image.thumbnail_url)
    expect(photo.closest('a')).toHaveAttribute('href', image.url)
  })

  it('offers the author Edit and Delete', async () => {
    await showTimeline([makeLog({ author: me })])
    expect(await screen.findByRole('button', { name: /^Edit/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Remove/ })).toBeInTheDocument()
  })

  it('offers a lead Delete but never Edit on someone else’s entry', async () => {
    auth.role = 'LEAD'
    await showTimeline([makeLog({ author: someoneElse })])
    expect(await screen.findByRole('button', { name: /^Remove/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Edit/ })).not.toBeInTheDocument()
  })

  it('offers a volunteer neither on someone else’s entry', async () => {
    await showTimeline([makeLog({ author: someoneElse })])
    expect(screen.queryByRole('button', { name: /^Edit/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument()
  })

  it('lets an exec who also volunteers here remove from a closed term', async () => {
    auth.user = makeUser({ id: 1, is_exec: true })
    await showTimeline([makeLog({ author: someoneElse, semester: 9 })])
    expect(await screen.findByRole('button', { name: /^Remove/ })).toBeInTheDocument()
  })

  it('offers an author nothing once the term has closed', async () => {
    await showTimeline([makeLog({ author: me, semester: 9 })])
    expect(screen.queryByRole('button', { name: /^Edit/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument()
  })
})

describe('ProjectTimelinePage feed', () => {
  const old = makeSemester({ id: 9, slug: 'old', name: 'Old Semester', is_current: false })

  function stub({
    logs = [makeLog({ author: me })],
    count,
    members = [],
    route = '/projects/shiksha',
    remove = { status: 204 },
  }: {
    logs?: DailyLog[]
    count?: number
    members?: Membership[]
    route?: string
    remove?: Reply
  } = {}) {
    const calls = stubApi({
      'GET /api/projects/shiksha/': { body: makeProject() },
      'GET /api/semesters/': { body: paginated([open, old]) },
      'GET /api/semesters/current/': { body: open },
      'GET /api/memberships/': { body: paginated(members) },
      'GET /api/logs/': { body: paginated(logs, count) },
      'POST /api/logs/': { status: 201, body: makeLog() },
      'PATCH /api/logs/300/': { body: makeLog() },
      'DELETE /api/logs/300/': remove,
    })
    renderApp(<ProjectTimelinePage />, { route, path: '/projects/:slug' })
    return calls
  }

  const entryLoaded = () => screen.findByRole('heading', { name: 'Saturday session' })
  const editable = () => screen.findByRole('button', { name: /^Edit/ })
  const logCalls = (calls: ReturnType<typeof stub>) =>
    calls.filter((call) => call.path === '/api/logs/' && call.method === 'GET')

  beforeEach(() => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
  })

  it('credits the author and marks a draft', async () => {
    stub({ logs: [makeLog({ author: someoneElse, status: 'DRAFT' })] })
    await entryLoaded()
    expect(screen.getByText('By Priya Nair')).toBeInTheDocument()
    expect(screen.getByText('Draft')).toBeInTheDocument()
  })

  it('leaves the attendee line off when nobody is listed', async () => {
    stub({ logs: [makeLog({ attendees: [] })] })
    await entryLoaded()
    expect(screen.queryByText(/present for/)).not.toBeInTheDocument()
  })

  it('reads an entry with no hours as one', async () => {
    stub({ logs: [makeLog({ hours: undefined, attendees: [me] })] })
    await entryLoaded()
    expect(screen.getByText(/1 present for 1 hour:/)).toBeInTheDocument()
  })

  it('filters by kind on the server', async () => {
    const calls = stub()
    await entryLoaded()

    await userEvent.click(screen.getByRole('button', { name: 'Meetings' }))

    await waitFor(() =>
      expect(logCalls(calls).some((call) => call.query.get('kind') === 'MOM')).toBe(true),
    )
  })

  it('searches on the server and says how many matched', async () => {
    const calls = stub({ count: 2 })
    await entryLoaded()

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search entries' }), 'bus')

    await waitFor(() =>
      expect(logCalls(calls).some((call) => call.query.get('q') === 'bus')).toBe(true),
    )
    expect(await screen.findByText(/2 entries match “\s*bus”/)).toBeInTheDocument()
  })

  it('invites the first entry on an empty term', async () => {
    stub({ logs: [] })
    expect(await screen.findByText('No entries yet')).toBeInTheDocument()
  })

  it('distinguishes a filter that found nothing', async () => {
    stub({ logs: [] })
    await screen.findByText('No entries yet')

    await userEvent.click(screen.getByRole('button', { name: 'Visits' }))

    expect(await screen.findByText('No entries match')).toBeInTheDocument()
  })

  it('reads a past term from the URL and freezes it', async () => {
    const calls = stub({ route: '/projects/shiksha?semester=old', logs: [makeLog({ semester: 9 })] })
    await entryLoaded()

    expect(logCalls(calls)[0]?.query.get('semester')).toBe('old')
    expect(await screen.findByText(/This semester is closed/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New entry' })).not.toBeInTheDocument()
  })

  it('switches term through the URL', async () => {
    stub()
    await entryLoaded()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: /semester/i }))
    await user.click(screen.getByRole('option', { name: 'Old Semester' }))

    expect(currentLocation()).toBe('/projects/shiksha?semester=old')
  })

  it('tells a former member why they cannot add anything', async () => {
    auth.role = null
    stub()
    expect(await screen.findByText(/you can read entries but not add or edit/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New entry' })).not.toBeInTheDocument()
  })

  it('files a new entry and closes the form', async () => {
    const calls = stub()
    await entryLoaded()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'New entry' }))
    await user.type(screen.getByRole('textbox', { name: /^title/i }), 'Weekly session')
    await user.type(screen.getByRole('textbox', { name: /^what happened/i }), 'Taught fractions.')
    // The default date is today, which a fixed test semester need not contain.
    fireEvent.change(screen.getByLabelText(/^Date/), { target: { value: '2026-08-02' } })
    await user.click(screen.getByRole('button', { name: 'Save entry' }))

    await waitFor(() => expect(calls.some((call) => call.method === 'POST')).toBe(true))
    await waitFor(() => expect(screen.queryByText('New timeline entry')).not.toBeInTheDocument())
  })

  it('keeps one editor open at a time', async () => {
    stub()
    await entryLoaded()
    const user = userEvent.setup()

    await user.click(await editable())
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'New entry' }))
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save entry' })).toBeInTheDocument()
  })

  it('closes the editor once saved', async () => {
    stub()
    const user = userEvent.setup()

    await user.click(await editable())
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument(),
    )
  })

  it('steps back after removing the only row on the last page', async () => {
    const calls = stub({ count: 11 })
    await screen.findByText('Page 1 of 2')
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Older' }))
    await screen.findByText('Page 2 of 2')
    await user.click(await screen.findByRole('button', { name: /^Remove “/ }))
    await user.click(screen.getByRole('button', { name: 'Remove' }))

    await waitFor(() => expect(logCalls(calls).at(-1)?.query.get('page')).toBe('1'))
  })

  it('confirms before removing', async () => {
    const calls = stub()
    await editable()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: /^Remove “/ }))
    expect(screen.getByText('Remove from the timeline?')).toBeInTheDocument()
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Remove' }))

    await waitFor(() => expect(calls.some((call) => call.method === 'DELETE')).toBe(true))
  })

  it('backs out of removing', async () => {
    const calls = stub()
    await editable()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: /^Remove “/ }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByText('Remove from the timeline?')).not.toBeInTheDocument()
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false)
  })

  it('shows a refused removal', async () => {
    stub({ remove: { status: 403, body: { detail: 'Not allowed.' } } })
    await editable()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: /^Remove “/ }))
    await user.click(screen.getByRole('button', { name: 'Remove' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Not allowed.')
  })

  it('turns a count into pages of ten and asks for the next', async () => {
    const calls = stub({ count: 25 })
    expect(await screen.findByText('Page 1 of 3')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Older' }))

    await waitFor(() =>
      expect(logCalls(calls).some((call) => call.query.get('page') === '2')).toBe(true),
    )
  })

  it('returns to page one when the filter changes', async () => {
    const calls = stub({ count: 25 })
    await screen.findByText('Page 1 of 3')
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Older' }))
    await screen.findByText('Page 2 of 3')
    await user.click(screen.getByRole('button', { name: 'Visits' }))

    await waitFor(() => {
      const last = logCalls(calls).at(-1)
      expect(last?.query.get('kind')).toBe('MOV')
      expect(last?.query.get('page')).toBe('1')
    })
  })

  describe('roster rail', () => {
    const volunteer = makeMembership({
      id: 2,
      role: 'VOLUNTEER',
      user: makeUser({ id: 2, full_name: 'Priya Nair' }),
    })

    it('shows this term’s members', async () => {
      stub({ members: [volunteer] })
      expect(await screen.findByRole('heading', { name: 'Members' })).toBeInTheDocument()
    })

    it('is hidden from a volunteer on an empty term', async () => {
      stub()
      await entryLoaded()
      expect(screen.queryByRole('heading', { name: 'Members' })).not.toBeInTheDocument()
    })

    it('still appears for a lead on an empty term, so they can build it', async () => {
      auth.role = 'LEAD'
      stub()
      expect(await screen.findByRole('button', { name: 'Add member' })).toBeInTheDocument()
    })

    it('lets a lead remove a volunteer', async () => {
      auth.role = 'LEAD'
      stub({ members: [volunteer] })
      expect(
        await screen.findByRole('button', { name: 'Remove Priya Nair from this semester' }),
      ).toBeInTheDocument()
    })

    it('gives a volunteer no roster controls', async () => {
      stub({ members: [volunteer] })
      await screen.findByRole('heading', { name: 'Members' })
      expect(screen.queryByRole('button', { name: 'Add member' })).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Remove Priya Nair from this semester' }),
      ).not.toBeInTheDocument()
    })
  })
})
