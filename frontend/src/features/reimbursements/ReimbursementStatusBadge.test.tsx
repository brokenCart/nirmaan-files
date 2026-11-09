import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { REIMBURSEMENT_STATUS_LABELS, REIMBURSEMENT_STATUSES } from '@/api/types'
import { ReimbursementStatusBadge } from '@/features/reimbursements/ReimbursementStatusBadge'

describe('ReimbursementStatusBadge', () => {
  it.each(REIMBURSEMENT_STATUSES)('labels %s', (status) => {
    render(<ReimbursementStatusBadge status={status} />)
    expect(screen.getByText(REIMBURSEMENT_STATUS_LABELS[status])).toBeInTheDocument()
  })
})
