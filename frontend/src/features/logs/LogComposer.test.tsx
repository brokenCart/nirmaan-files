import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { LogComposer } from '@/features/logs/LogComposer'
import { makeLog, makeMembership, makeProject, makeSemester, makeUser } from '@/test/factories'
import { renderApp, stubApi } from '@/test/render'

const project = makeProject({ id: 100 })
const members = [
  makeMembership({ id: 1, user: makeUser({ id: 11, full_name: 'Aarav Sharma' }) }),
  makeMembership({ id: 2, user: makeUser({ id: 12, full_name: 'Priya Nair' }) }),
]

const hoursInput = () => screen.getByRole<HTMLInputElement>('spinbutton', { name: /^hours/i })

function renderComposer(log?: Parameters<typeof LogComposer>[0]['log']) {
  const onDone = vi.fn()
  const view = renderApp(
    <LogComposer project={project} members={members} log={log} onDone={onDone} />,
  )
  return { onDone, form: view.container.querySelector('form') as HTMLFormElement }
}

async function fillRequiredFields() {
  const user = userEvent.setup()
  await user.type(screen.getByRole('textbox', { name: /^title/i }), 'Weekly session')
  await user.type(screen.getByRole('textbox', { name: /^what happened/i }), 'Taught fractions.')
  return user
}

describe('LogComposer hours', () => {
  it('starts a new entry at one hour', () => {
    stubApi({})
    renderComposer()
    expect(hoursInput()).toHaveValue(1)
  })

  it('offers half-hour steps from 0.5 to 24', () => {
    stubApi({})
    renderComposer()
    expect(hoursInput()).toHaveAttribute('step', '0.5')
    expect(hoursInput()).toHaveAttribute('min', '0.5')
    expect(hoursInput()).toHaveAttribute('max', '24')
  })

  it('loads an existing entry’s hours', () => {
    stubApi({})
    renderComposer(makeLog({ hours: 2.5 }))
    expect(hoursInput()).toHaveValue(2.5)
  })

  it('reads an entry with no hours as one', () => {
    stubApi({})
    renderComposer(makeLog({ hours: undefined }))
    expect(hoursInput()).toHaveValue(1)
  })

  it.each(['0', '-1', '0.7', '1.25', '24.5', ''])('refuses %j', async (value) => {
    const calls = stubApi({})
    const { form } = renderComposer(makeLog())

    fireEvent.change(hoursInput(), { target: { value } })
    // Directly, because a browser's own step check would stop a real click
    // first. This covers the schema behind it.
    fireEvent.submit(form)

    expect(await screen.findByText(/half-hour steps/)).toBeInTheDocument()
    expect(calls).toHaveLength(0)
  })

  it.each([
    ['0.5', 0.5],
    ['1.5', 1.5],
    ['24', 24],
  ])('sends %s to the server as a number', async (value, expected) => {
    const calls = stubApi({ 'PATCH /api/logs/300/': { body: makeLog() } })
    const { form, onDone } = renderComposer(makeLog())

    fireEvent.change(hoursInput(), { target: { value } })
    fireEvent.submit(form)

    await waitFor(() => expect(onDone).toHaveBeenCalledOnce())
    expect(calls[0]?.body).toMatchObject({ hours: expected })
  })
})

describe('LogComposer submission', () => {
  it('files a new entry against the project', async () => {
    const calls = stubApi({ 'POST /api/logs/': { status: 201, body: makeLog() } })
    const { onDone } = renderComposer()
    const user = await fillRequiredFields()

    await user.click(screen.getByRole('checkbox', { name: 'Priya Nair' }))
    await user.click(screen.getByRole('button', { name: 'Save entry' }))

    await waitFor(() => expect(onDone).toHaveBeenCalledOnce())
    expect(calls[0]?.body).toMatchObject({
      project: 100,
      kind: 'MOV',
      status: 'PUBLISHED',
      title: 'Weekly session',
      body: 'Taught fractions.',
      hours: 1,
      attendee_ids: [12],
    })
  })

  it('never sends the project on an edit', async () => {
    const calls = stubApi({ 'PATCH /api/logs/300/': { body: makeLog() } })
    const { onDone } = renderComposer(makeLog())

    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(onDone).toHaveBeenCalledOnce())
    expect(calls[0]?.body).not.toHaveProperty('project')
  })

  it('clears attendees when every box is unticked', async () => {
    const calls = stubApi({ 'PATCH /api/logs/300/': { body: makeLog() } })
    const { onDone } = renderComposer(makeLog({ attendees: [makeUser({ id: 11 })] }))

    await userEvent.click(screen.getByRole('checkbox', { name: 'Aarav Sharma' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(onDone).toHaveBeenCalledOnce())
    expect(calls[0]?.body).toMatchObject({ attendee_ids: [] })
  })

  it('needs a title and a body', async () => {
    const calls = stubApi({})
    renderComposer()

    await userEvent.click(screen.getByRole('button', { name: 'Save entry' }))

    expect(await screen.findByText('Give the entry a title.')).toBeInTheDocument()
    expect(screen.getByText('Write what happened.')).toBeInTheDocument()
    expect(calls).toHaveLength(0)
  })

  it('shows the server’s refusal and stays open', async () => {
    stubApi({ 'POST /api/logs/': { status: 403, body: { detail: 'That term is closed.' } } })
    const { onDone } = renderComposer()
    const user = await fillRequiredFields()

    await user.click(screen.getByRole('button', { name: 'Save entry' }))

    expect(await screen.findByText('That term is closed.')).toBeInTheDocument()
    expect(onDone).not.toHaveBeenCalled()
  })

  it('files a meeting as a private draft', async () => {
    const calls = stubApi({ 'POST /api/logs/': { status: 201, body: makeLog() } })
    const { onDone } = renderComposer()
    const user = await fillRequiredFields()

    await user.click(screen.getByRole('button', { name: /entry type/i }))
    await user.click(screen.getByRole('option', { name: 'MOM (Minutes of Meeting)' }))
    await user.click(screen.getByRole('button', { name: /status/i }))
    await user.click(screen.getByRole('option', { name: 'Save as a private draft' }))
    await user.click(screen.getByRole('button', { name: 'Save entry' }))

    await waitFor(() => expect(onDone).toHaveBeenCalledOnce())
    expect(calls[0]?.body).toMatchObject({ kind: 'MOM', status: 'DRAFT' })
  })

  it('keeps the date inside the open term', () => {
    stubApi({})
    renderApp(
      <LogComposer
        project={project}
        members={members}
        semester={makeSemester({
          name: 'First Semester',
          starts_on: '2026-08-01',
          ends_on: '2026-12-15',
        })}
        onDone={vi.fn()}
      />,
    )

    const date = screen.getByLabelText(/^Date/)
    expect(date).toHaveAttribute('min', '2026-08-01')
    expect(date).toHaveAttribute('max', '2026-12-15')
    expect(screen.getByText('Must fall within First Semester.')).toBeInTheDocument()
  })

  it('counts who is ticked', async () => {
    stubApi({})
    renderComposer()
    expect(screen.getByText(/0 selected/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('checkbox', { name: 'Priya Nair' }))

    expect(screen.getByText(/1 selected/)).toBeInTheDocument()
  })

  it('explains an empty roster', () => {
    stubApi({})
    renderApp(<LogComposer project={project} members={[]} onDone={vi.fn()} />)
    expect(screen.getByText('No members this semester yet.')).toBeInTheDocument()
  })

  it('cancels without saving', async () => {
    const calls = stubApi({})
    const { onDone } = renderComposer()

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onDone).toHaveBeenCalledOnce()
    expect(calls).toHaveLength(0)
  })
})
