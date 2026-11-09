import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ResourceForm } from '@/features/resources/ResourceForm'
import { makeProject, makeResource } from '@/test/factories'
import { renderApp, stubApi } from '@/test/render'

const URL_HINT = 'People still need Drive access to open it.'

function renderForm(resource?: Parameters<typeof ResourceForm>[0]['resource']) {
  const onDone = vi.fn()
  const view = renderApp(<ResourceForm project={makeProject()} resource={resource} onDone={onDone} />)
  return { onDone, form: view.container.querySelector('form') as HTMLFormElement }
}

describe('ResourceForm', () => {
  it('adds a trimmed link to the project', async () => {
    const calls = stubApi({ 'POST /api/resources/': { status: 201, body: makeResource() } })
    const { onDone } = renderForm()
    const user = userEvent.setup()

    await user.type(screen.getByRole('textbox', { name: /name/i }), ' Drive folder ')
    await user.type(screen.getByRole('textbox', { name: /link/i }), 'https://drive.google.com/x')
    await user.click(screen.getByRole('button', { name: 'Add link' }))

    await waitFor(() => expect(onDone).toHaveBeenCalledOnce())
    expect(calls[0]?.body).toEqual({
      project: 100,
      kind: 'FOLDER',
      title: 'Drive folder',
      url: 'https://drive.google.com/x',
      description: '',
    })
  })

  it('refuses something that is not a link', async () => {
    const calls = stubApi({})
    const { form } = renderForm(makeResource())

    fireEvent.change(screen.getByRole('textbox', { name: /link/i }), {
      target: { value: 'not a link' },
    })
    fireEvent.submit(form)

    expect(await screen.findByText('That is not a link.')).toBeInTheDocument()
    expect(calls).toHaveLength(0)
  })

  it('lets someone else’s link be edited without moving projects', async () => {
    const calls = stubApi({ 'PATCH /api/resources/400/': { body: makeResource() } })
    const { onDone } = renderForm(makeResource())

    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(onDone).toHaveBeenCalledOnce())
    expect(calls[0]?.body).not.toHaveProperty('project')
  })

  it('shows a server URL error on the field, once', async () => {
    stubApi({
      'PATCH /api/resources/400/': { status: 400, body: { url: ['Already on this shelf.'] } },
    })
    renderForm(makeResource())

    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findAllByText('Already on this shelf.')).toHaveLength(1)
    expect(screen.queryByText(URL_HINT)).not.toBeInTheDocument()
  })

  it('shows any other refusal in the note', async () => {
    stubApi({ 'PATCH /api/resources/400/': { status: 403, body: { detail: 'Not yours.' } } })
    renderForm(makeResource())

    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText('Not yours.')).toBeInTheDocument()
    expect(screen.getByText(URL_HINT)).toBeInTheDocument()
  })
})
