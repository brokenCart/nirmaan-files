import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Article, ArticleRevision, EffectiveRole, User } from '@/api/types'
import { ArticlePage } from '@/features/knowledge/ArticlePage'
import { makeArticle, makeProject, makeRevision, makeUser } from '@/test/factories'
import { currentLocation, renderApp, stubApi } from '@/test/render'
import type { Reply } from '@/test/render'

const auth = vi.hoisted(() => ({
  role: null as EffectiveRole | null,
  user: undefined as User | undefined,
}))

vi.mock('@/auth/AuthContext', () => ({
  useAuth: () => ({ user: auth.user, roleIn: () => auth.role }),
}))

const me = makeUser({ id: 1 })
const someoneElse = makeUser({ id: 2, full_name: 'Priya Nair' })

const page = makeArticle({ id: 600, title: 'Timings', body: 'Start at **ten**.', created_by: someoneElse })
const history = [
  makeRevision({ id: 2, body: 'Newest text.', title: 'Newest title' }),
  makeRevision({
    id: 1,
    body: 'Oldest text.',
    title: 'Oldest title',
    note: 'First draft',
    edited_by: someoneElse,
  }),
]

function show({
  article = page,
  revisions = history,
  route = '/projects/shiksha/knowledge/600',
  remove = { status: 204 },
}: {
  article?: Article
  revisions?: ArticleRevision[]
  route?: string
  remove?: Reply
} = {}) {
  const calls = stubApi({
    'GET /api/projects/shiksha/': { body: makeProject() },
    'GET /api/articles/600/': { body: article },
    'GET /api/articles/600/revisions/': { body: revisions },
    'PATCH /api/articles/600/': { body: article },
    'DELETE /api/articles/600/': remove,
  })
  renderApp(<ArticlePage />, { route, path: '/projects/:slug/knowledge/:articleId' })
  return calls
}

const pageLoaded = () => screen.findByRole('heading', { name: 'Timings' })

async function openHistory() {
  const user = userEvent.setup()
  await pageLoaded()
  await user.click(screen.getByRole('button', { name: /Page history/ }))
  await screen.findAllByRole('button', { name: 'Preview' })
  return user
}

beforeEach(() => {
  auth.user = me
  auth.role = 'VOLUNTEER'
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
})

describe('ArticlePage reading', () => {
  it('renders the page as Markdown and credits its authors', async () => {
    show()
    await pageLoaded()

    expect(screen.getByText('ten').tagName).toBe('STRONG')
    expect(screen.getByText(/Started .* by Priya Nair/)).toBeInTheDocument()
  })

  it('links back to the index', async () => {
    show()
    await pageLoaded()
    expect(screen.getByRole('link', { name: 'Back to all pages' })).toHaveAttribute(
      'href',
      '/projects/shiksha/knowledge',
    )
  })

  it('refuses an id that is not a number', async () => {
    stubApi({ 'GET /api/projects/shiksha/': { body: makeProject() } })
    renderApp(<ArticlePage />, {
      route: '/projects/shiksha/knowledge/abc',
      path: '/projects/:slug/knowledge/:articleId',
    })
    expect(await screen.findByRole('alert')).toHaveTextContent('Page not found.')
  })

  it('refuses a page that belongs to another project', async () => {
    show({ article: makeArticle({ id: 600, project_slug: 'aarogya' }) })
    expect(await screen.findByRole('alert')).toHaveTextContent('Page not found.')
  })

  it('shows a page that failed to load', async () => {
    stubApi({
      'GET /api/projects/shiksha/': { body: makeProject() },
      'GET /api/articles/600/': { status: 404, body: { detail: 'Gone.' } },
    })
    renderApp(<ArticlePage />, {
      route: '/projects/shiksha/knowledge/600',
      path: '/projects/:slug/knowledge/:articleId',
    })
    expect(await screen.findByRole('alert')).toHaveTextContent('Gone.')
  })
})

describe('ArticlePage permissions', () => {
  it('lets any member edit, but a volunteer not remove someone else’s page', async () => {
    show()
    await pageLoaded()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
  })

  it('lets the starter remove their own', async () => {
    show({ article: makeArticle({ id: 600, title: 'Timings', created_by: me }) })
    await pageLoaded()
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument()
  })

  it('lets a lead remove anyone’s', async () => {
    auth.role = 'LEAD'
    show()
    await pageLoaded()
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument()
  })

  it('leaves a former member reading only', async () => {
    auth.role = null
    show({ article: makeArticle({ id: 600, title: 'Timings', created_by: me }) })
    await pageLoaded()
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
  })
})

describe('ArticlePage editing', () => {
  it('opens the editor and returns to the page on save', async () => {
    const calls = show()
    await pageLoaded()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByRole('heading', { name: 'Edit page' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await screen.findByRole('heading', { name: 'Timings' })
    expect(calls.some((call) => call.method === 'PATCH')).toBe(true)
  })

  it('returns to the page on Cancel', async () => {
    const calls = show()
    await pageLoaded()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.getByRole('heading', { name: 'Timings' })).toBeInTheDocument()
    expect(calls.some((call) => call.method === 'PATCH')).toBe(false)
  })
})

describe('ArticlePage removing', () => {
  beforeEach(() => {
    auth.role = 'LEAD'
  })

  it('confirms, removes, and returns to the index', async () => {
    const calls = show()
    await pageLoaded()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Remove' }))
    expect(screen.getByText('Delete this page?')).toBeInTheDocument()
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Remove' }))

    await waitFor(() => expect(currentLocation()).toBe('/projects/shiksha/knowledge'))
    expect(calls.some((call) => call.method === 'DELETE')).toBe(true)
  })

  it('backs out', async () => {
    const calls = show()
    await pageLoaded()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Remove' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByText('Delete this page?')).not.toBeInTheDocument()
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false)
  })

  it('shows a refusal and stays on the page', async () => {
    show({ remove: { status: 403, body: { detail: 'Not allowed.' } } })
    await pageLoaded()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Remove' }))
    await user.click(screen.getByRole('button', { name: 'Remove' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Not allowed.')
    expect(currentLocation()).toBe('/projects/shiksha/knowledge/600')
  })
})

describe('ArticlePage history', () => {
  const revisionCalls = (calls: ReturnType<typeof show>) =>
    calls.filter((call) => call.path.endsWith('/revisions/'))

  it('is not fetched until opened', async () => {
    const calls = show()
    await pageLoaded()
    expect(revisionCalls(calls)).toHaveLength(0)

    await openHistory()
    expect(revisionCalls(calls)).toHaveLength(1)
  })

  it.each([
    [1, '1 version'],
    [3, '3 versions'],
  ])('counts %d as “%s”', async (revision_count, label) => {
    show({ article: makeArticle({ id: 600, title: 'Timings', revision_count }) })
    await pageLoaded()
    expect(screen.getByText(label)).toBeInTheDocument()
  })

  it('lists who changed what', async () => {
    show()
    await openHistory()
    expect(screen.getByText(/First draft/)).toBeInTheDocument()
    expect(screen.getByText('Priya Nair')).toBeInTheDocument()
  })

  it('previews an old version and toggles it off', async () => {
    show()
    const user = await openHistory()
    const oldestPreview = screen.getAllByRole('button', { name: 'Preview' })[1] as HTMLElement

    await user.click(oldestPreview)
    expect(screen.getByRole('heading', { name: 'Oldest title' })).toBeInTheDocument()
    expect(screen.getByText('Oldest text.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Viewing' }))
    expect(screen.queryByText('Oldest text.')).not.toBeInTheDocument()
  })

  it('offers Restore on every version except the current one', async () => {
    show()
    await openHistory()
    expect(screen.getAllByRole('button', { name: 'Restore' })).toHaveLength(1)
  })

  it('offers a former member no Restore', async () => {
    auth.role = null
    show()
    await openHistory()
    expect(screen.queryByRole('button', { name: 'Restore' })).not.toBeInTheDocument()
  })

  it('restores by saving the older text as an ordinary edit', async () => {
    const calls = show()
    const user = await openHistory()

    await user.click(screen.getByRole('button', { name: 'Restore' }))

    expect(screen.getByRole('heading', { name: 'Restore an older version' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /^content/i })).toHaveValue('Oldest text.')

    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => {
      expect(calls.find((call) => call.method === 'PATCH')?.body).toMatchObject({
        body: 'Oldest text.',
      })
    })
  })

  it('shows a history that failed to load', async () => {
    stubApi({
      'GET /api/projects/shiksha/': { body: makeProject() },
      'GET /api/articles/600/': { body: page },
      'GET /api/articles/600/revisions/': { status: 500, body: { detail: 'History broke.' } },
    })
    renderApp(<ArticlePage />, {
      route: '/projects/shiksha/knowledge/600',
      path: '/projects/:slug/knowledge/:articleId',
    })
    await pageLoaded()

    await userEvent.click(screen.getByRole('button', { name: /Page history/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('History broke.')
  })
})
