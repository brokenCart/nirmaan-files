import type { AttendanceRow } from '@/api/types'

/** Which column the chart plots. One measure at a time keeps it to one axis. */
export type Measure = 'visits' | 'meetings' | 'total' | 'hours'

export const MEASURES: Measure[] = ['visits', 'meetings', 'total', 'hours']

export const MEASURE_LABELS: Record<Measure, string> = {
  visits: 'Visits',
  meetings: 'Meetings',
  total: 'Total',
  hours: 'Hours',
}

export function valueOf(row: AttendanceRow, measure: Measure): number {
  return row[measure]
}

export function formatHours(hours: number): string {
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`
}
