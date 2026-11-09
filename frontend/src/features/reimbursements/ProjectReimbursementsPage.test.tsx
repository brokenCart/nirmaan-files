import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { EffectiveRole, Reimbursement, ReimbursementSummary, User } from '@/api/types'
import { ProjectReimbursementsPage } from '@/features/reimbursements/ProjectReimbursementsPage'
import {
  makeLogImage,
  makeProject,
  makeReimbursement,
  makeReimbursementSummary,
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
  useAuth: () => ({ user: auth.user, roleIn: () => auth.role }),
}))

const me = makeUser({ id: 1, full_name: 'Aarav Sharma' })
const someoneElse = makeUser({ id: 2, full_name: 'Priya Nair' })
const open = makeSemester({ id: 10, slug: 'open', name: 'First Semester' })
const old = makeSemester({ id: 9, slug: 'old', name: 'Old Semester', is_current: false })

const theirs = makeReimbursement({ id: 500, title: 'Bus fare', submitted_by: someoneElse })
const mine = makeReimbursement({ id: 500, title: 'Bus fare', submitted_by: me })

function show({
  rows = [theirs],
  count,
  summary = makeReimbursementSummary(),
  route = '/projects/shiksha/reimbursements',
  remove = { status: 204 },
}: {
  rows?: Reimbursement[]
  count?: number
  summary?: ReimbursementSummary
  route?: string
  remove?: Reply
} = {}) {
  const calls = stubApi({
    'GET /api/projects/shiksha/': { body: makeProject() },
    'GET /api/semesters/': { body: paginated([open, old]) },
    'GET /api/semesters/current/': { body: open },
    'GET /api/reimbursements/': { body: paginated(rows, count) },
    'GET /api/reimbursements/summary/': { body: summary },
    'POST /api/reimbursements/': { status: 201, body: makeReimbursement() },
    'PATCH /api/reimbursements/500/': { body: makeReimbursement() },
    'DELETE /api/reimbursements/500/': remove,
  })
  renderApp(<ProjectReimbursementsPage />, { route, path: '/projects/:slug/reimbursements' })
  return calls
}

const rowLoaded = () => screen.findByRole('heading', { name: 'Bus fare' })

/** Waits for the open term as well: the row's controls depend on it. */
async function controlsReady() {
  await rowLoaded()
  await screen.findByRole('button', { name: /semester/i })
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /semester/i })).toHaveTextContent('First Semester'),
  )
}

const listCalls = (calls: ReturnType<typeof show>) =>
  calls.filter((call) => call.path === '/api/reimbursements/')
const summaryCalls = (calls: ReturnType<typeof show>) =>
  calls.filter((call) => call.path === '/api/reimbursements/summary/')

beforeEach(() => {
  auth.user = me
  auth.role = 'VOLUNTEER'
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
})

describe('ProjectReimbursementsPage framing', () => {
  it('shows a claim’s receipts, each linking to the full image', async () => {
    const receipt = makeLogImage()
    show({ rows: [{ ...theirs, receipts: [receipt] }] })

    const image = await screen.findByRole('img', { name: 'Receipt 1 from Bus fare' })
    expect(image).toHaveAttribute('src', receipt.thumbnail_url)
    expect(image.closest('a')).toHaveAttribute('href', receipt.url)
  })

  it('tells a volunteer these are only their own', async () => {
    show()
    expect(await screen.findByText(/Your expense claims for this project/)).toBeInTheDocument()
  })

  it.each(['LEAD', 'FINANCE_LEAD'] as const)('tells %s this is the whole queue', async (role) => {
    auth.role = role
    show()
    expect(await screen.findByText(/Expense claims from this project/)).toBeInTheDocument()
  })

  it('tells exec this is the whole queue, even when reported as a volunteer', async () => {
    auth.user = makeUser({ id: 1, is_exec: true })
    show()
    expect(await screen.findByText(/Expense claims from this project/)).toBeInTheDocument()
  })

  it('explains the missing buttons to a lead', async () => {
    auth.role = 'LEAD'
    show()
    expect(await screen.findByText(/Only the finance lead can approve/)).toBeInTheDocument()
  })

  it('does not say that to the finance lead', async () => {
    auth.role = 'FINANCE_LEAD'
    show()
    await rowLoaded()
    expect(screen.queryByText(/Only the finance lead can approve/)).not.toBeInTheDocument()
  })

  it('leaves a former member unable to file', async () => {
    auth.role = null
    show()
    expect(await screen.findByText(/You can see your past requests/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New request' })).not.toBeInTheDocument()
  })

  it('freezes a closed term', async () => {
    show({ route: '/projects/shiksha/reimbursements?semester=old' })
    expect(await screen.findByText(/This semester is closed/)).toBeInTheDocument()
    await rowLoaded()
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'New request' })).not.toBeInTheDocument(),
    )
  })

  it('asks for the term in the URL', async () => {
    const calls = show({ route: '/projects/shiksha/reimbursements?semester=old' })
    await rowLoaded()
    expect(listCalls(calls)[0]?.query.get('semester')).toBe('old')
  })

  it('switches term through the URL', async () => {
    show()
    await controlsReady()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: /semester/i }))
    await user.click(screen.getByRole('option', { name: 'Old Semester' }))

    expect(currentLocation()).toBe('/projects/shiksha/reimbursements?semester=old')
  })
})

describe('ProjectReimbursementsPage status tabs', () => {
  const summary = makeReimbursementSummary({
    PENDING: { count: 2, total: '960.00' },
    APPROVED: { count: 1, total: '100.00' },
  })

  it('counts from the summary, not the page in hand', async () => {
    show({ summary })
    await rowLoaded()
    expect(await screen.findByRole('button', { name: /^All\s*3$/ })).toBeInTheDocument()
  })

  it('shows a total only on a status with claims in it', async () => {
    show({ summary })
    await rowLoaded()

    expect(
      await screen.findByRole('button', { name: /^Awaiting review\s*2\s*₹960\.00$/ }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Rejected\s*0$/ })).toBeInTheDocument()
  })

  it('filters the list but not the counts', async () => {
    const calls = show({ summary })
    await rowLoaded()

    await userEvent.click(screen.getByRole('button', { name: /^Approved/ }))

    await waitFor(() =>
      expect(listCalls(calls).some((call) => call.query.get('status') === 'APPROVED')).toBe(true),
    )
    expect(summaryCalls(calls).every((call) => !call.query.has('status'))).toBe(true)
  })

  it('searches both the list and the counts', async () => {
    const calls = show({ summary })
    await rowLoaded()

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search requests' }), 'bus')

    await waitFor(() => {
      expect(listCalls(calls).some((call) => call.query.get('q') === 'bus')).toBe(true)
      expect(summaryCalls(calls).some((call) => call.query.get('q') === 'bus')).toBe(true)
    })
  })
})

describe('ProjectReimbursementsPage empty states', () => {
  it('invites a member to file the first claim', async () => {
    show({ rows: [] })
    expect(await screen.findByText('No requests yet')).toBeInTheDocument()
    expect(screen.getByText(/File a request to get the money back/)).toBeInTheDocument()
  })

  it('names the status when a tab is empty', async () => {
    show({ rows: [] })
    await screen.findByText('No requests yet')

    await userEvent.click(screen.getByRole('button', { name: /^Rejected/ }))

    expect(await screen.findByText('Nothing here')).toBeInTheDocument()
    expect(screen.getByText('No requests in this term are rejected.')).toBeInTheDocument()
  })

  it('distinguishes a search that found nothing', async () => {
    show({ rows: [] })
    await screen.findByText('No requests yet')

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search requests' }), 'bus')

    expect(await screen.findByText('No requests match')).toBeInTheDocument()
  })

  it('shows a list that failed to load', async () => {
    stubApi({
      'GET /api/projects/shiksha/': { body: makeProject() },
      'GET /api/semesters/': { body: paginated([open]) },
      'GET /api/semesters/current/': { body: open },
      'GET /api/reimbursements/': { status: 500, body: { detail: 'Queue broke.' } },
      'GET /api/reimbursements/summary/': { body: makeReimbursementSummary() },
    })
    renderApp(<ProjectReimbursementsPage />, {
      route: '/projects/shiksha/reimbursements',
      path: '/projects/:slug/reimbursements',
    })
    expect(await screen.findByRole('alert')).toHaveTextContent('Queue broke.')
  })
})

describe('ProjectReimbursementsPage rows', () => {
  it('shows the amount in rupees and who filed it', async () => {
    show()
    await rowLoaded()
    expect(screen.getByText('₹480.50')).toBeInTheDocument()
    expect(screen.getByText(/Filed by Priya Nair on/)).toBeInTheDocument()
  })

  it('says “you” on the reader’s own claim', async () => {
    show({ rows: [mine] })
    await rowLoaded()
    expect(screen.getByText(/Filed by you on/)).toBeInTheDocument()
  })

  it('shows the decision and the reviewer’s note', async () => {
    show({
      rows: [
        makeReimbursement({
          title: 'Bus fare',
          status: 'REJECTED',
          reviewed_by: someoneElse,
          reviewed_at: '2026-08-02T10:00:00Z',
          review_note: 'No receipt.',
        }),
      ],
    })
    await rowLoaded()
    expect(screen.getByText(/Rejected by Priya Nair on/)).toBeInTheDocument()
    expect(screen.getByText('No receipt.')).toBeInTheDocument()
  })
})

describe('ProjectReimbursementsPage controls', () => {
  it('gives the finance lead review controls', async () => {
    auth.role = 'FINANCE_LEAD'
    show()
    await controlsReady()
    expect(await screen.findByRole('button', { name: 'Approve' })).toBeInTheDocument()
  })

  it('gives a lead none', async () => {
    auth.role = 'LEAD'
    show()
    await controlsReady()
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
  })

  it('explains why a finance lead cannot review their own claim', async () => {
    auth.role = 'FINANCE_LEAD'
    show({ rows: [mine] })
    await controlsReady()
    expect(screen.getByText(/You can’t review your own request/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
  })

  it('offers the submitter Edit and Withdraw while pending', async () => {
    show({ rows: [mine] })
    await controlsReady()
    expect(await screen.findByRole('button', { name: 'Edit' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Withdraw “Bus fare”' })).toBeInTheDocument()
  })

  it('takes them away once decided', async () => {
    show({ rows: [{ ...mine, status: 'APPROVED' }] })
    await controlsReady()
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Withdraw/ })).not.toBeInTheDocument()
  })

  it('lets an exec who also volunteers here remove a decided claim', async () => {
    auth.user = makeUser({ id: 1, is_exec: true })
    show({ rows: [{ ...theirs, status: 'APPROVED' }] })
    await controlsReady()
    expect(await screen.findByRole('button', { name: 'Remove “Bus fare”' })).toBeInTheDocument()
  })

  it('lets a lead remove but not edit someone else’s claim', async () => {
    auth.role = 'LEAD'
    show()
    await controlsReady()
    expect(await screen.findByRole('button', { name: 'Remove “Bus fare”' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
  })

  it('keeps one editor open at a time', async () => {
    show({ rows: [mine] })
    await controlsReady()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Edit' }))
    expect(screen.getByRole('heading', { name: 'Edit request' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'New request' }))
    expect(screen.queryByRole('heading', { name: 'Edit request' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'New request' })).toBeInTheDocument()
  })

  it('closes the editor once saved', async () => {
    show({ rows: [mine] })
    await controlsReady()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Edit' }))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Edit request' })).not.toBeInTheDocument(),
    )
  })

  it('closes the new request form once filed', async () => {
    const calls = show()
    await controlsReady()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'New request' }))
    await user.type(screen.getByRole('textbox', { name: /title/i }), 'Chart paper')
    await user.type(screen.getByRole('textbox', { name: /amount/i }), '120')
    await user.type(screen.getByRole('textbox', { name: /details/i }), 'For the session.')
    await user.click(screen.getByRole('button', { name: 'Submit request' }))

    await waitFor(() => expect(calls.some((call) => call.method === 'POST')).toBe(true))
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'New request' })).not.toBeInTheDocument(),
    )
  })

  it('confirms with the amount, then withdraws', async () => {
    const calls = show({ rows: [mine] })
    await controlsReady()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Withdraw “Bus fare”' }))
    expect(screen.getByText(/Withdraw this ₹480\.50 request\?/)).toBeInTheDocument()
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Withdraw' }))

    await waitFor(() => expect(calls.some((call) => call.method === 'DELETE')).toBe(true))
  })

  it('backs out of a withdrawal', async () => {
    const calls = show({ rows: [mine] })
    await controlsReady()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Withdraw “Bus fare”' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByText(/Withdraw this/)).not.toBeInTheDocument()
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false)
  })

  it('shows a refused withdrawal', async () => {
    show({ rows: [mine], remove: { status: 403, body: { detail: 'Already reviewed.' } } })
    await controlsReady()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Withdraw “Bus fare”' }))
    await user.click(screen.getByRole('button', { name: 'Withdraw' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Already reviewed.')
  })
})

describe('ProjectReimbursementsPage paging', () => {
  it('turns a count into pages of twenty', async () => {
    show({ count: 45 })
    expect(await screen.findByText('Page 1 of 3')).toBeInTheDocument()
  })

  it('asks for the next page', async () => {
    const calls = show({ count: 45 })
    await screen.findByText('Page 1 of 3')

    await userEvent.click(screen.getByRole('button', { name: 'Older' }))

    await waitFor(() =>
      expect(listCalls(calls).some((call) => call.query.get('page') === '2')).toBe(true),
    )
  })

  it('steps back after removing the only row on the last page', async () => {
    const calls = show({ rows: [mine], count: 21 })
    await screen.findByText('Page 1 of 2')
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Older' }))
    await screen.findByText('Page 2 of 2')
    await user.click(await screen.findByRole('button', { name: 'Withdraw “Bus fare”' }))
    await user.click(screen.getByRole('button', { name: 'Withdraw' }))

    await waitFor(() => expect(listCalls(calls).at(-1)?.query.get('page')).toBe('1'))
  })

  it('returns to page one when the filter changes', async () => {
    const calls = show({ count: 45 })
    await screen.findByText('Page 1 of 3')
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Older' }))
    await screen.findByText('Page 2 of 3')
    await user.click(screen.getByRole('button', { name: /^Rejected/ }))

    await waitFor(() => {
      const last = listCalls(calls).at(-1)
      expect(last?.query.get('status')).toBe('REJECTED')
      expect(last?.query.get('page')).toBe('1')
    })
  })
})
