import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ArticleForm } from '@/features/knowledge/ArticleForm'
import { makeArticle, makeProject } from '@/test/factories'
import { renderApp, stubApi } from '@/test/render'

const nameField = () => screen.getByRole('textbox', { name: /^name/i })
const contentField = () => screen.getByRole('textbox', { name: /^content/i })
const noteField = () => screen.queryByRole('textbox', { name: /^what changed/i })

function show(props: Partial<Parameters<typeof ArticleForm>[0]> = {}) {
  const onDone = vi.fn()
  const view = renderApp(<ArticleForm project={makeProject()} onDone={onDone} {...props} />)
  return { onDone, form: view.container.querySelector('form') as HTMLFormElement }
}

describe('ArticleForm creating', () => {
  it('starts a page and reports its new id', async () => {
    const calls = stubApi({ 'POST /api/articles/': { status: 201, body: makeArticle({ id: 777 }) } })
    const { onDone } = show()
    const user = userEvent.setup()

    await user.type(nameField(), ' Bus timings ')
    await user.type(contentField(), ' Leave at nine. ')
    await user.click(screen.getByRole('button', { name: 'Create page' }))

    await waitFor(() => expect(onDone).toHaveBeenCalledWith(777))
    expect(calls[0]?.body).toEqual({
      project: 100,
      category: 'CONTEXT',
      title: 'Bus timings',
      body: 'Leave at nine.',
      revision_note: '',
    })
  })

  it('files the page under the chosen topic', async () => {
    const calls = stubApi({ 'POST /api/articles/': { status: 201, body: makeArticle() } })
    const { onDone } = show()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: /topic/i }))
    await user.click(screen.getByRole('option', { name: 'Lessons learned' }))
    await user.type(nameField(), 'Harvest')
    await user.type(contentField(), 'Avoid it.')
    await user.click(screen.getByRole('button', { name: 'Create page' }))

    await waitFor(() => expect(onDone).toHaveBeenCalledOnce())
    expect(calls[0]?.body).toMatchObject({ category: 'LESSON' })
  })

  it('does not ask what changed on a first version', () => {
    stubApi({})
    show()
    expect(noteField()).not.toBeInTheDocument()
  })

  it('needs a name and content', async () => {
    const calls = stubApi({})
    show()

    await userEvent.click(screen.getByRole('button', { name: 'Create page' }))

    expect(await screen.findByText('Give the page a name.')).toBeInTheDocument()
    expect(screen.getByText('Write something before saving.')).toBeInTheDocument()
    expect(calls).toHaveLength(0)
  })

  it('treats whitespace as empty', async () => {
    const calls = stubApi({})
    const { form } = show()

    fireEvent.change(nameField(), { target: { value: '   ' } })
    fireEvent.change(contentField(), { target: { value: 'x' } })
    fireEvent.submit(form)

    expect(await screen.findByText('Give the page a name.')).toBeInTheDocument()
    expect(calls).toHaveLength(0)
  })

  it('offers Cancel only when the caller handles it', () => {
    stubApi({})
    show()
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
  })
})

describe('ArticleForm editing', () => {
  const article = makeArticle({ id: 600, title: 'Timings', body: 'Current text.' })

  it('starts from the page as it stands', () => {
    stubApi({})
    show({ article })
    expect(nameField()).toHaveValue('Timings')
    expect(contentField()).toHaveValue('Current text.')
  })

  it('starts from an older body when restoring', () => {
    stubApi({})
    show({ article, initialBody: 'Older text.' })
    expect(contentField()).toHaveValue('Older text.')
  })

  it('saves the note against the revision, without moving projects', async () => {
    const calls = stubApi({ 'PATCH /api/articles/600/': { body: article } })
    const { onDone } = show({ article })
    const user = userEvent.setup()

    await user.type(noteField() as HTMLElement, ' Fixed the bus timing ')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(onDone).toHaveBeenCalledWith(600))
    expect(calls[0]?.body).toMatchObject({ revision_note: 'Fixed the bus timing' })
    expect(calls[0]?.body).not.toHaveProperty('project')
  })

  it('caps the note at 200 characters', async () => {
    const calls = stubApi({})
    const { form } = show({ article })

    fireEvent.change(noteField() as HTMLElement, { target: { value: 'x'.repeat(201) } })
    fireEvent.submit(form)

    await waitFor(() => expect(form.textContent).toMatch(/200/))
    expect(calls).toHaveLength(0)
  })

  it('cancels', async () => {
    stubApi({})
    const onCancel = vi.fn()
    show({ article, onCancel })

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('shows a title clash on the name field, once', async () => {
    stubApi({
      'PATCH /api/articles/600/': { status: 400, body: { title: ['That name is taken.'] } },
    })
    const { onDone } = show({ article })

    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findAllByText('That name is taken.')).toHaveLength(1)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(onDone).not.toHaveBeenCalled()
  })

  it('shows any other refusal in the note', async () => {
    stubApi({ 'PATCH /api/articles/600/': { status: 403, body: { detail: 'Not a member.' } } })
    show({ article })

    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Not a member.')
  })
})
