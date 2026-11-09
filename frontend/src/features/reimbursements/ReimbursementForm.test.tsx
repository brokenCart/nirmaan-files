import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ReimbursementForm } from '@/features/reimbursements/ReimbursementForm'
import { makeLogImage, makeProject, makeReimbursement } from '@/test/factories'
import { renderApp, stubApi } from '@/test/render'

const amountField = () => screen.getByRole('textbox', { name: /amount/i })

function renderForm(reimbursement?: Parameters<typeof ReimbursementForm>[0]['reimbursement']) {
  const onDone = vi.fn()
  renderApp(
    <ReimbursementForm project={makeProject()} reimbursement={reimbursement} onDone={onDone} />,
  )
  return onDone
}

async function fill(amount: string) {
  const user = userEvent.setup()
  await user.type(screen.getByRole('textbox', { name: /title/i }), '  Bus fare ')
  await user.type(amountField(), amount)
  await user.type(screen.getByRole('textbox', { name: /details/i }), 'Return tickets.')
  await user.click(screen.getByRole('button', { name: 'Submit request' }))
}

describe('ReimbursementForm', () => {
  it('sends the amount as the string that was typed', async () => {
    const calls = stubApi({
      'POST /api/reimbursements/': { status: 201, body: makeReimbursement() },
    })
    const onDone = renderForm()

    await fill('480.50')

    await waitFor(() => expect(onDone).toHaveBeenCalledOnce())
    expect(calls[0]?.body).toEqual({
      project: 100,
      title: 'Bus fare',
      amount: '480.50',
      description: 'Return tickets.',
    })
  })

  it.each([
    ['abc', 'Enter an amount in rupees, like 480 or 480.50.'],
    ['1.234', 'Enter an amount in rupees, like 480 or 480.50.'],
    ['123456789', 'Enter an amount in rupees, like 480 or 480.50.'],
    ['0', 'Enter an amount greater than zero.'],
    ['0.00', 'Enter an amount greater than zero.'],
  ])('refuses %s', async (amount, message) => {
    const calls = stubApi({})
    renderForm()

    await fill(amount)

    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(calls).toHaveLength(0)
  })

  it('edits without moving the claim between projects', async () => {
    const calls = stubApi({ 'PATCH /api/reimbursements/500/': { body: makeReimbursement() } })
    const onDone = renderForm(makeReimbursement())

    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(onDone).toHaveBeenCalledOnce())
    expect(calls[0]?.body).not.toHaveProperty('project')
  })

  it('shows the server’s refusal and stays open', async () => {
    stubApi({
      'PATCH /api/reimbursements/500/': { status: 403, body: { detail: 'Already reviewed.' } },
    })
    const onDone = renderForm(makeReimbursement())

    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText('Already reviewed.')).toBeInTheDocument()
    expect(onDone).not.toHaveBeenCalled()
  })
})

describe('ReimbursementForm receipts', () => {
  const receipt = (name: string) => new File(['x'], name, { type: 'image/jpeg' })
  const picker = () => screen.getByLabelText<HTMLInputElement>(/^receipts/i)
  const saved = makeReimbursement({ id: 77 })

  beforeEach(() => {
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: () => 'blob:preview', revokeObjectURL: () => {} }),
    )
  })

  it('uploads receipts after the request is filed', async () => {
    const calls = stubApi({
      'POST /api/reimbursements/': { status: 201, body: saved },
      'POST /api/reimbursements/77/receipts/': { status: 201, body: makeLogImage() },
    })
    const onDone = renderForm()

    await userEvent.upload(picker(), [receipt('a.jpg'), receipt('b.jpg')])
    await fill('480')

    await waitFor(() => expect(onDone).toHaveBeenCalledOnce())
    expect(calls.filter((call) => call.path.endsWith('/receipts/'))).toHaveLength(2)
  })

  it('retries a failed receipt without filing the claim twice', async () => {
    const calls = stubApi({
      'POST /api/reimbursements/': { status: 201, body: saved },
      'PATCH /api/reimbursements/77/': { body: saved },
      'POST /api/reimbursements/77/receipts/': [
        { status: 503, body: { detail: 'Google Drive could not be reached. Try again.' } },
        { status: 201, body: makeLogImage() },
      ],
    })
    const onDone = renderForm()

    await userEvent.upload(picker(), receipt('a.jpg'))
    await fill('480')

    expect(await screen.findByText(/1 of your receipts didn't upload/i)).toBeInTheDocument()
    expect(onDone).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(onDone).toHaveBeenCalledOnce())
    expect(
      calls.filter((call) => call.method === 'POST' && call.path === '/api/reimbursements/'),
    ).toHaveLength(1)
  })

  it('removes an existing receipt when an edit is saved', async () => {
    const claim = makeReimbursement({
      receipts: [makeLogImage({ id: 5, original_name: 'old.jpg' })],
    })
    const calls = stubApi({
      'PATCH /api/reimbursements/500/': { body: claim },
      'DELETE /api/reimbursements/500/receipts/5/': { status: 204 },
    })
    const onDone = renderForm(claim)

    await userEvent.click(screen.getByRole('button', { name: /remove old.jpg/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(onDone).toHaveBeenCalledOnce())
    expect(calls.some((call) => call.method === 'DELETE')).toBe(true)
  })

  it('leaves the picker out until storage is set up', () => {
    stubApi({})
    renderApp(
      <ReimbursementForm project={makeProject({ image_uploads_enabled: false })} onDone={vi.fn()} />,
    )
    expect(screen.queryByLabelText(/^receipts/i)).not.toBeInTheDocument()
  })
})
