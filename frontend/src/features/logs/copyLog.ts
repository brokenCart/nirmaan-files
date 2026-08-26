import type { DailyLog } from '@/api/types'

/**
 * `DD/MM/YY` from the API's ISO `YYYY-MM-DD`.
 *
 * Split rather than parsed through `Date`: `new Date('2026-08-01')` is read as
 * UTC midnight, which renders as the previous day anywhere behind UTC. The
 * string already holds the parts we want.
 */
function shortDate(iso: string): string {
  const [year = '', month = '', day = ''] = iso.split('-')
  return `${day}/${month}/${year.slice(2)}`
}

/**
 * One entry as plain text, for pasting into a report or a chat.
 *
 * ```
 * MOV
 * Date: 01/08/26
 * Attendees: Aarav Sharma, Priya Nair
 * <body>
 * ```
 *
 * The attendee line is dropped entirely when nobody is listed, rather than
 * pasting a dangling label.
 */
export function formatLogForCopy(log: DailyLog): string {
  const lines: string[] = [log.kind, `Date: ${shortDate(log.occurred_on)}`]

  if (log.attendees.length > 0) {
    lines.push(
      `Attendees: ${log.attendees.map((a) => a.full_name || a.email).join(', ')}`,
    )
  }

  lines.push(log.body)
  return lines.join('\n')
}
