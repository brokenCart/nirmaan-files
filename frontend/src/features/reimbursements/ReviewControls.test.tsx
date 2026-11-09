import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import type { Reimbursement } from '@/api/types'
import { ReviewControls } from '@/features/reimbursements/ReviewControls'
import { makeReimbursement } from '@/test/factories'
import { renderApp, stubApi } from '@/test/render'
import type { Reply } from '@/test/render'

const REVIEW = 'POST /api/reimbursements/500/review/'

function show(status: Reimbursement['status'] = 'PENDING', reply: Reply = { body: makeReimbursement() }) {
  const calls = stubApi({ [REVIEW]: reply })
  renderApp(<ReviewControls reimbursement={makeReimbursement({ status })} projectSlug="shiksha" />)
  return calls
}

const button = (name: string) => screen.getByRole('button', { name })
const buttonNames = () => screen.getAllByRole('button').map((item) => item.textContent)

describe('ReviewControls choices', () => {
  it('offers both decisions on a pending claim', () => {
    show()
    expect(buttonNames()).toEqual(['Approve', 'Reject'])
  })

  it('offers only the reversal on an approved claim', () => {
    show('APPROVED')
    expect(buttonNames()).toEqual(['Change to rejected'])
  })

  it('offers only the reversal on a rejected claim', () => {
    show('REJECTED')
    expect(buttonNames()).toEqual(['Change to approved'])
  })
})

describe('ReviewControls approving', () => {
  it('needs no note', async () => {
    const calls = show()
    const user = userEvent.setup()

    await user.click(button('Approve'))
    expect(screen.getByRole('textbox', { name: /note \(optional\)/i })).toBeInTheDocument()
    await user.click(button('Approve request'))

    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]?.body).toEqual({ status: 'APPROVED', note: '' })
  })

  it('sends an optional note, trimmed', async () => {
    const calls = show()
    const user = userEvent.setup()

    await user.click(button('Approve'))
    await user.type(screen.getByRole('textbox'), '  Paid in cash ')
    await user.click(button('Approve request'))

    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]?.body).toEqual({ status: 'APPROVED', note: 'Paid in cash' })
  })

  it('goes back to the buttons once saved', async () => {
    show()
    const user = userEvent.setup()

    await user.click(button('Approve'))
    await user.click(button('Approve request'))

    await waitFor(() => expect(buttonNames()).toEqual(['Approve', 'Reject']))
  })
})

describe('ReviewControls rejecting', () => {
  it('cannot be sent without a reason', async () => {
    show()
    await userEvent.click(button('Reject'))
    expect(screen.getByRole('textbox', { name: /reason for rejecting/i })).toBeInTheDocument()
    expect(button('Reject request')).toBeDisabled()
  })

  it('does not count whitespace as a reason', async () => {
    show()
    const user = userEvent.setup()

    await user.click(button('Reject'))
    await user.type(screen.getByRole('textbox'), '   ')

    expect(button('Reject request')).toBeDisabled()
  })

  it('sends the reason', async () => {
    const calls = show()
    const user = userEvent.setup()

    await user.click(button('Reject'))
    await user.type(screen.getByRole('textbox'), 'No receipt.')
    await user.click(button('Reject request'))

    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]?.body).toEqual({ status: 'REJECTED', note: 'No receipt.' })
  })

  it('can reverse an approval', async () => {
    const calls = show('APPROVED')
    const user = userEvent.setup()

    await user.click(button('Change to rejected'))
    await user.type(screen.getByRole('textbox'), 'Duplicate claim.')
    await user.click(button('Reject request'))

    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]?.body).toEqual({ status: 'REJECTED', note: 'Duplicate claim.' })
  })
})

describe('ReviewControls recovering', () => {
  it('forgets the note on Cancel', async () => {
    const calls = show()
    const user = userEvent.setup()

    await user.click(button('Reject'))
    await user.type(screen.getByRole('textbox'), 'Draft reason')
    await user.click(button('Cancel'))
    await user.click(button('Reject'))

    expect(screen.getByRole('textbox')).toHaveValue('')
    expect(calls).toHaveLength(0)
  })

  it('shows a refusal and keeps what was typed', async () => {
    show('PENDING', { status: 403, body: { detail: 'You filed this one.' } })
    const user = userEvent.setup()

    await user.click(button('Reject'))
    await user.type(screen.getByRole('textbox'), 'No receipt.')
    await user.click(button('Reject request'))

    expect(await screen.findByRole('alert')).toHaveTextContent('You filed this one.')
    expect(screen.getByRole('textbox')).toHaveValue('No receipt.')
  })
})
