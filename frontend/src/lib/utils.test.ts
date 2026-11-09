import { describe, expect, it } from 'vitest'

import { cn, dateParts, formatDate, formatDateTime, formatRupees } from '@/lib/utils'

describe('date handling', () => {
  it('runs behind UTC, or the drift tests below prove nothing', () =>
    expect(new Date().getTimezoneOffset()).toBeGreaterThan(0))

  it('does not drift a date-only string to the previous day', () =>
    expect(formatDate('2026-08-01')).toBe('1 Aug 2026'))

  it('splits a date for the timeline gutter without drifting', () =>
    expect(dateParts('2026-08-01')).toEqual({ day: '1', month: 'Aug', year: '2026' }))

  it('keeps the time on a timestamp', () =>
    expect(formatDateTime('2026-08-01T10:30:00Z')).toMatch(/1 Aug 2026.*3:30/))
})

describe('formatRupees', () => {
  it('always shows paise', () => expect(formatRupees('480')).toBe('₹480.00'))
  it('groups in lakhs', () => expect(formatRupees('100000.5')).toBe('₹1,00,000.50'))

  it.each(['oops', 'Infinity'])('returns %s unchanged', (amount) =>
    expect(formatRupees(amount)).toBe(amount),
  )
})

describe('cn', () => {
  it('lets the later Tailwind class win', () => expect(cn('p-2', 'p-4')).toBe('p-4'))
  it('drops falsy values', () => expect(cn('a', false, undefined, 'b')).toBe('a b'))
})
