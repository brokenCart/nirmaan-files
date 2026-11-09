import { QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import {
  queryKeys,
  useAddMember,
  useArticleRevisions,
  useAttendance,
  useCreateArticle,
  useCreateLog,
  useCreateReimbursement,
  useCreateResource,
  useDeleteArticle,
  useDeleteLog,
  useDeleteReimbursement,
  useDeleteResource,
  useLogs,
  useReimbursementSummary,
  useRemoveMember,
  useReviewReimbursement,
  useUpdateArticle,
  useUpdateLog,
  useUpdateReimbursement,
  useUpdateResource,
} from '@/features/projects/queries'
import { makeArticle } from '@/test/factories'
import type { Reply } from '@/test/render'
import { makeQueryClient, paginated, stubApi } from '@/test/render'

const SLUG = 'shiksha'

function setup() {
  const client = makeQueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, wrapper }
}

/** Runs a mutation and returns every cache key it invalidated. */
async function invalidatedBy<V>(
  useHook: () => { mutateAsync: (variables: V) => Promise<unknown> },
  variables: V,
  route: string,
  reply: Reply = { body: {} },
) {
  const { client, wrapper } = setup()
  stubApi({ [route]: reply })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const { result } = renderHook(useHook, { wrapper })

  await result.current.mutateAsync(variables)

  return invalidate.mock.calls.map(([filters]) => filters?.queryKey)
}

const LOG = {
  project: 100,
  kind: 'MOV',
  title: 'Visit',
  body: 'Went.',
  occurred_on: '2026-08-01',
} as const

const LOG_KEYS = [['logs'], ['projects', SLUG], ['attendance', SLUG], ['archive', SLUG]]
const ROSTER_KEYS = [['memberships', SLUG], ['attendance', SLUG], ['archive', SLUG]]

describe('what each mutation makes stale', () => {
  it('a new entry moves the feed, counts and archive', async () => {
    const keys = await invalidatedBy(() => useCreateLog(SLUG), LOG, 'POST /api/logs/')
    expect(keys).toEqual(LOG_KEYS)
  })

  it('an edited entry does too, since hours and attendees feed the totals', async () => {
    const keys = await invalidatedBy(
      () => useUpdateLog(SLUG),
      { id: 1, hours: 2 },
      'PATCH /api/logs/1/',
    )
    expect(keys).toEqual(LOG_KEYS)
  })

  it('a removed entry clears every project’s counts, having no slug', async () => {
    const keys = await invalidatedBy(() => useDeleteLog(), 1, 'DELETE /api/logs/1/', {
      status: 204,
    })
    expect(keys).toEqual([['logs'], ['attendance'], ['archive']])
  })

  it('adding a member touches the roster, attendance and archive', async () => {
    const keys = await invalidatedBy(
      () => useAddMember(SLUG),
      { project: 100, user_email: 'a@x.in' },
      'POST /api/memberships/',
    )
    expect(keys).toEqual(ROSTER_KEYS)
  })

  it('removing a member does the same', async () => {
    const keys = await invalidatedBy(() => useRemoveMember(SLUG), 1, 'DELETE /api/memberships/1/', {
      status: 204,
    })
    expect(keys).toEqual(ROSTER_KEYS)
  })

  it('every change to a link touches only the shelf', async () => {
    expect(
      await invalidatedBy(
        () => useCreateResource(SLUG),
        { project: 100, title: 'x', url: 'https://x.in' },
        'POST /api/resources/',
      ),
    ).toEqual([['resources', SLUG]])
    expect(
      await invalidatedBy(
        () => useUpdateResource(SLUG),
        { id: 1, title: 'y' },
        'PATCH /api/resources/1/',
      ),
    ).toEqual([['resources', SLUG]])
    expect(
      await invalidatedBy(() => useDeleteResource(SLUG), 1, 'DELETE /api/resources/1/', {
        status: 204,
      }),
    ).toEqual([['resources', SLUG]])
  })

  it('a new page touches only the index', async () => {
    const keys = await invalidatedBy(
      () => useCreateArticle(SLUG),
      { project: 100, title: 'x', body: 'y' },
      'POST /api/articles/',
    )
    expect(keys).toEqual([['articles', SLUG]])
  })

  it('an edited page refreshes the index and its own history', async () => {
    const keys = await invalidatedBy(
      () => useUpdateArticle(SLUG),
      { id: 600, body: 'new' },
      'PATCH /api/articles/600/',
      { body: makeArticle({ id: 600 }) },
    )
    expect(keys).toEqual([['articles', SLUG], ['article', 600]])
  })

  it('a removed page refreshes the index and itself', async () => {
    const keys = await invalidatedBy(() => useDeleteArticle(SLUG), 600, 'DELETE /api/articles/600/', {
      status: 204,
    })
    expect(keys).toEqual([['articles', SLUG], ['article', 600]])
  })

  it('every reimbursement change clears the whole queue prefix', async () => {
    const queue = [['reimbursements', SLUG]]
    expect(
      await invalidatedBy(
        () => useCreateReimbursement(SLUG),
        { project: 100, title: 'x', amount: '1.00', description: 'y' },
        'POST /api/reimbursements/',
      ),
    ).toEqual(queue)
    expect(
      await invalidatedBy(
        () => useUpdateReimbursement(SLUG),
        { id: 1, title: 'y' },
        'PATCH /api/reimbursements/1/',
      ),
    ).toEqual(queue)
    expect(
      await invalidatedBy(
        () => useReviewReimbursement(SLUG),
        { id: 1, status: 'APPROVED' },
        'POST /api/reimbursements/1/review/',
      ),
    ).toEqual(queue)
    expect(
      await invalidatedBy(() => useDeleteReimbursement(SLUG), 1, 'DELETE /api/reimbursements/1/', {
        status: 204,
      }),
    ).toEqual(queue)
  })
})

describe('query keys', () => {
  it('put every term’s attendance under the project prefix', () => {
    const prefix = queryKeys.attendanceForProject(SLUG)
    expect(queryKeys.attendance(SLUG).slice(0, prefix.length)).toEqual([...prefix])
    expect(queryKeys.attendance(SLUG, 'old').slice(0, prefix.length)).toEqual([...prefix])
  })

  it('keep two terms’ attendance apart', () => {
    expect(queryKeys.attendance(SLUG, 'old')).not.toEqual(queryKeys.attendance(SLUG))
  })

  it('put every term’s roster under the project prefix', () => {
    const prefix = queryKeys.membersForProject(SLUG)
    expect(queryKeys.members(SLUG, 'old').slice(0, prefix.length)).toEqual([...prefix])
  })

  it('hang a page’s history off the page, so an edit clears both', () => {
    expect(queryKeys.articleRevisions(600).slice(0, 2)).toEqual([...queryKeys.article(600)])
  })
})

describe('what each query asks for', () => {
  it('sends the term to the attendance endpoint', async () => {
    const { wrapper } = setup()
    const calls = stubApi({ 'GET /api/projects/shiksha/attendance/': { body: [] } })
    const { result } = renderHook(() => useAttendance(SLUG, 'old'), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(calls[0]?.query.get('semester')).toBe('old')
  })

  it('passes timeline filters through', async () => {
    const { wrapper } = setup()
    const calls = stubApi({ 'GET /api/logs/': { body: paginated([]) } })
    const { result } = renderHook(() => useLogs({ project: SLUG, kind: 'MOV', page: 2 }), {
      wrapper,
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(calls[0]?.query.toString()).toBe('project=shiksha&kind=MOV&page=2')
  })

  it('keeps status and page out of the summary, which counts per status', async () => {
    const { wrapper } = setup()
    const calls = stubApi({ 'GET /api/reimbursements/summary/': { body: {} } })
    const { result } = renderHook(
      () => useReimbursementSummary(SLUG, { status: 'APPROVED', page: 3, q: 'bus' }),
      { wrapper },
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(calls[0]?.query.toString()).toBe('project=shiksha&q=bus')
  })

  it('does not fetch a page’s history until asked', async () => {
    const { wrapper } = setup()
    const calls = stubApi({ 'GET /api/articles/600/revisions/': { body: [] } })

    const closed = renderHook(() => useArticleRevisions(600, false), { wrapper })
    expect(closed.result.current.fetchStatus).toBe('idle')
    expect(calls).toHaveLength(0)

    const open = renderHook(() => useArticleRevisions(600, true), { wrapper })
    await waitFor(() => expect(open.result.current.isSuccess).toBe(true))
    expect(calls).toHaveLength(1)
  })
})
