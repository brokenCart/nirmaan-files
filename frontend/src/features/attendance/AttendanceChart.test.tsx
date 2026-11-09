import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { AttendanceChart } from '@/features/attendance/AttendanceChart'
import { makeAttendanceRow, makeUser } from '@/test/factories'

const row = (id: number, name: string, hours: number) =>
  makeAttendanceRow({ user: makeUser({ id, full_name: name }), hours, visits: 1, meetings: 2 })

const barWidths = () =>
  screen
    .getAllByRole('tooltip', { hidden: true })
    .map((tooltip) => (tooltip.previousElementSibling as HTMLElement).style.width)

describe('AttendanceChart', () => {
  it('scales bars against the highest value', () => {
    render(<AttendanceChart measure="hours" rows={[row(1, 'A', 10), row(2, 'B', 2.5)]} />)
    expect(barWidths()).toEqual(['100%', '25%'])
  })

  it('shows decimal hours as given', () => {
    render(<AttendanceChart measure="hours" rows={[row(1, 'A', 2.5)]} />)
    expect(screen.getByText('2.5')).toBeInTheDocument()
  })

  it('draws no bars for a roster with no attendance', () => {
    render(<AttendanceChart measure="hours" rows={[row(1, 'A', 0), row(2, 'B', 0)]} />)
    expect(barWidths()).toEqual(['0%', '0%'])
  })

  it('falls back to the email for an unnamed member', () => {
    const unnamed = makeAttendanceRow({ user: makeUser({ full_name: '', email: 'new@x.in' }) })
    render(<AttendanceChart measure="visits" rows={[unnamed]} />)
    expect(screen.getByTitle('new@x.in')).toBeInTheDocument()
  })

  it('carries every figure in the tooltip', () => {
    render(<AttendanceChart measure="visits" rows={[row(1, 'A', 1.5)]} />)
    expect(screen.getByRole('tooltip', { hidden: true })).toHaveTextContent(
      'A · 1 visits · 2 meetings · 1.5 hours',
    )
  })
})
