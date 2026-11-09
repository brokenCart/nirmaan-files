import { describe, expect, it } from 'vitest'

import { formatLogForCopy } from '@/features/logs/copyLog'
import { makeLog, makeUser } from '@/test/factories'

describe('formatLogForCopy', () => {
  it('lays out kind, date, attendees and body', () => {
    const log = makeLog({
      kind: 'MOM',
      occurred_on: '2026-08-01',
      body: 'Assigned owners.',
      attendees: [makeUser({ full_name: 'Aarav Sharma' }), makeUser({ full_name: 'Priya Nair' })],
    })

    expect(formatLogForCopy(log)).toBe(
      'MOM\nDate: 01/08/26\nAttendees: Aarav Sharma, Priya Nair\nAssigned owners.',
    )
  })

  it('drops the attendee line when nobody is listed', () =>
    expect(formatLogForCopy(makeLog({ attendees: [] }))).not.toContain('Attendees'))

  it('falls back to the email for an unnamed attendee', () => {
    const attendee = makeUser({ full_name: '', email: 'new@pilani.bits-pilani.ac.in' })
    expect(formatLogForCopy(makeLog({ attendees: [attendee] }))).toContain(
      'Attendees: new@pilani.bits-pilani.ac.in',
    )
  })
})
