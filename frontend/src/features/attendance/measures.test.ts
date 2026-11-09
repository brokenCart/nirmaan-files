import { describe, expect, it } from 'vitest'

import { formatHours, MEASURES, valueOf } from '@/features/attendance/measures'
import { makeAttendanceRow } from '@/test/factories'

describe('formatHours', () => {
  it.each([
    [1, '1 hour'],
    [1.5, '1.5 hours'],
    [0.5, '0.5 hours'],
    [0, '0 hours'],
    [12, '12 hours'],
  ])('%d reads as %s', (hours, expected) => expect(formatHours(hours)).toBe(expected))
})

describe('valueOf', () => {
  const row = makeAttendanceRow({ visits: 2, meetings: 3, total: 5, hours: 7.5 })

  it('reads each measure off its own column', () =>
    expect(MEASURES.map((measure) => valueOf(row, measure))).toEqual([2, 3, 5, 7.5]))
})
