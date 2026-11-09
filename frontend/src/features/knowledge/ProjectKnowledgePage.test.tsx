import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ArticleListItem, EffectiveRole } from '@/api/types'
import { ProjectKnowledgePage } from '@/features/knowledge/ProjectKnowledgePage'
import { makeArticle, makeArticleListItem, makeProject, makeUser } from '@/test/factories'
import { currentLocation, renderApp, stubApi } from '@/test/render'

const auth = vi.hoisted(() => ({ role: null as EffectiveRole | null }))

vi.mock('@/auth/AuthContext', () => ({ useAuth: () => ({ roleIn: () => auth.role }) }))

function show(rows: ArticleListItem[] = [makeArticleListItem()]) {
  const calls = stubApi({
    'GET /api/projects/shiksha/': { body: makeProject() },
    'GET /api/articles/': { body: rows },
    'POST /api/articles/': { status: 201, body: makeArticle({ id: 777 }) },
  })
  renderApp(<ProjectKnowledgePage />, {
    route: '/projects/shiksha/knowledge',
    path: '/projects/:slug/knowledge',
  })
  return calls
}

const listCalls = (calls: ReturnType<typeof show>) =>
  calls.filter((call) => call.path === '/api/articles/' && call.method === 'GET')

beforeEach(() => {
  auth.role = 'VOLUNTEER'
})

describe('ProjectKnowledgePage', () => {
  it('lists pages, linking each', async () => {
    show([makeArticleListItem({ id: 5, title: 'Timings', excerpt: 'Start at ten.' })])

    const link = await screen.findByRole('link', { name: /Timings/ })
    expect(link).toHaveAttribute('href', '/projects/shiksha/knowledge/5')
    expect(screen.getByText('Start at ten.')).toBeInTheDocument()
  })

  it('says who last edited, and counts versions only past the first', async () => {
    show([
      makeArticleListItem({
        id: 1,
        title: 'One',
        revision_count: 1,
        updated_by: makeUser({ full_name: 'Priya Nair' }),
      }),
      makeArticleListItem({ id: 2, title: 'Two', revision_count: 4 }),
    ])

    expect(await screen.findByText(/4 versions/)).toBeInTheDocument()
    expect(screen.getByText(/by Priya Nair$/)).toBeInTheDocument()
    expect(screen.queryByText(/1 versions/)).not.toBeInTheDocument()
  })

  it('searches on the server', async () => {
    const calls = show()
    await screen.findByRole('link', { name: /Saturday/ })

    await userEvent.type(screen.getByRole('textbox', { name: 'Search knowledge pages' }), 'bus')

    await waitFor(() =>
      expect(listCalls(calls).some((call) => call.query.get('q') === 'bus')).toBe(true),
    )
  })

  it('filters by topic', async () => {
    const calls = show()
    await screen.findByRole('link', { name: /Saturday/ })

    await userEvent.click(screen.getByRole('button', { name: 'Lessons learned' }))

    await waitFor(() =>
      expect(listCalls(calls).some((call) => call.query.get('category') === 'LESSON')).toBe(true),
    )
  })

  it('invites a member to write the first page', async () => {
    show([])
    expect(await screen.findByText('No pages yet')).toBeInTheDocument()
    expect(screen.getByText('Write the first page for this project.')).toBeInTheDocument()
  })

  it('tells a former member nobody has written one', async () => {
    auth.role = null
    show([])
    expect(await screen.findByText('No one has written a page yet.')).toBeInTheDocument()
  })

  it('distinguishes a search that found nothing', async () => {
    show([])
    await screen.findByText('No pages yet')

    await userEvent.type(screen.getByRole('textbox', { name: 'Search knowledge pages' }), 'bus')

    expect(await screen.findByText('No pages match')).toBeInTheDocument()
  })

  it('lets a member start a page and lands on it', async () => {
    show()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'New page' }))
    await user.type(screen.getByRole('textbox', { name: /^name/i }), 'Bus timings')
    await user.type(screen.getByRole('textbox', { name: /^content/i }), 'Leave at nine.')
    await user.click(screen.getByRole('button', { name: 'Create page' }))

    await waitFor(() => expect(currentLocation()).toBe('/projects/shiksha/knowledge/777'))
  })

  it('closes the new page form on Cancel', async () => {
    show()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'New page' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByText('New knowledge page')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New page' })).toBeInTheDocument()
  })

  it('leaves a former member reading only, and says so', async () => {
    auth.role = null
    show()

    expect(await screen.findByText(/you can read pages but not edit them/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New page' })).not.toBeInTheDocument()
  })

  it('shows a project that failed to load', async () => {
    stubApi({
      'GET /api/projects/shiksha/': { status: 404, body: { detail: 'Not found.' } },
      'GET /api/articles/': { body: [] },
    })
    renderApp(<ProjectKnowledgePage />, {
      route: '/projects/shiksha/knowledge',
      path: '/projects/:slug/knowledge',
    })

    expect(await screen.findByRole('alert')).toHaveTextContent('Not found.')
  })
})
