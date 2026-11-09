import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { User } from '@/api/types'
import { AddMemberForm } from '@/features/projects/AddMemberForm'
import { makeMembership, makeProject, makeSemester, makeUser } from '@/test/factories'
import { renderApp, stubApi } from '@/test/render'

const auth = vi.hoisted(() => ({ user: null as User | null }))

vi.mock('@/auth/AuthContext', () => ({ useAuth: () => ({ user: auth.user }) }))

const EMAIL = 'f20230001@pilani.bits-pilani.ac.in'
const emailField = () => screen.getByRole('textbox', { name: /^email/i })

function show() {
  const onDone = vi.fn()
  const view = renderApp(
    <AddMemberForm
      project={makeProject({ id: 100 })}
      semester={makeSemester({ id: 10, name: 'First Semester' })}
      onDone={onDone}
    />,
  )
  return { onDone, form: view.container.querySelector('form') as HTMLFormElement }
}

beforeEach(() => {
  auth.user = makeUser({ is_exec: false })
})

describe('AddMemberForm', () => {
  it('says which term the person joins', () => {
    stubApi({})
    show()
    expect(screen.getByText('First Semester')).toBeInTheDocument()
  })

  it('gives a lead no role picker', () => {
    stubApi({})
    show()
    expect(screen.getByText('Volunteer')).toBeInTheDocument()
    expect(screen.getByText('Only the Executive Committee can appoint leads.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /role/i })).not.toBeInTheDocument()
  })

  it('adds a volunteer to the named term', async () => {
    const calls = stubApi({ 'POST /api/memberships/': { status: 201, body: makeMembership() } })
    const { onDone } = show()

    await userEvent.type(emailField(), EMAIL)
    await userEvent.click(screen.getByRole('button', { name: 'Add member' }))

    await waitFor(() => expect(onDone).toHaveBeenCalledOnce())
    expect(calls[0]?.body).toEqual({
      project: 100,
      semester: 10,
      user_email: EMAIL,
      role: 'VOLUNTEER',
    })
  })

  it('lets exec appoint staff', async () => {
    auth.user = makeUser({ is_exec: true })
    const calls = stubApi({ 'POST /api/memberships/': { status: 201, body: makeMembership() } })
    const { onDone } = show()
    const user = userEvent.setup()

    await user.type(emailField(), EMAIL)
    await user.click(screen.getByRole('button', { name: /role/i }))
    await user.click(screen.getByRole('option', { name: 'Project Lead' }))
    await user.click(screen.getByRole('button', { name: 'Add member' }))

    await waitFor(() => expect(onDone).toHaveBeenCalledOnce())
    expect(calls[0]?.body).toMatchObject({ role: 'LEAD' })
  })

  it('needs an email', async () => {
    const calls = stubApi({})
    const { form } = show()

    fireEvent.submit(form)

    expect(await screen.findByText('Enter an email address.')).toBeInTheDocument()
    expect(calls).toHaveLength(0)
  })

  it('refuses something that is not an email', async () => {
    const calls = stubApi({})
    const { form } = show()

    fireEvent.change(emailField(), { target: { value: 'not-an-email' } })
    fireEvent.submit(form)

    expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument()
    expect(calls).toHaveLength(0)
  })

  it('shows an email refusal on the field, once', async () => {
    stubApi({
      'POST /api/memberships/': {
        status: 400,
        body: { user_email: ['Must be a campus address.'] },
      },
    })
    const { onDone } = show()

    await userEvent.type(emailField(), 'someone@gmail.com')
    await userEvent.click(screen.getByRole('button', { name: 'Add member' }))

    expect(await screen.findAllByText('Must be a campus address.')).toHaveLength(1)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(onDone).not.toHaveBeenCalled()
  })

  it('shows any other refusal in the note', async () => {
    stubApi({ 'POST /api/memberships/': { status: 403, body: { detail: 'That term is closed.' } } })
    show()

    await userEvent.type(emailField(), EMAIL)
    await userEvent.click(screen.getByRole('button', { name: 'Add member' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('That term is closed.')
  })

  it('cancels without saving', async () => {
    const calls = stubApi({})
    const { onDone } = show()

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onDone).toHaveBeenCalledOnce()
    expect(calls).toHaveLength(0)
  })
})
