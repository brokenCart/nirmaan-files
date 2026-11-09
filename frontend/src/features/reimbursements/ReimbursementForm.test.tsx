import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ReimbursementForm } from '@/features/reimbursements/ReimbursementForm'
import { makeProject, makeReimbursement } from '@/test/factories'
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
