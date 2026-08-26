import type { AttendanceRow } from '@/api/types'

import type { Measure } from './measures'
import { MEASURE_LABELS, valueOf } from './measures'

/**
 * Horizontal bars, one per member, for a single measure at a time.
 *
 * Deliberately not a library: this is one series of small integers, and the
 * exact figures sit in the table directly below — so the chart only has to
 * carry the ranking and the relative gaps.
 *
 * One series means one hue and no legend; the heading names what is plotted.
 * The value rides in its own grid column rather than floating over the track,
 * so a long bar can never collide with or clip its own label.
 */
export function AttendanceChart({ rows, measure }: { rows: AttendanceRow[]; measure: Measure }) {
  // A roster with no attendance at all would otherwise divide by zero and let
  // every bar claim the full width.
  const peak = Math.max(1, ...rows.map((row) => valueOf(row, measure)))

  return (
    <div
      role="img"
      aria-label={`${MEASURE_LABELS[measure]} per member. Exact figures follow in the table below.`}
      className="space-y-1.5"
    >
      {rows.map((row) => {
        const value = valueOf(row, measure)
        const name = row.user.full_name || row.user.email

        return (
          <div
            key={row.user.id}
            className="group grid grid-cols-[7rem_1fr_2.5rem] items-center gap-3 sm:grid-cols-[11rem_1fr_2.5rem]"
          >
            <span className="truncate text-right text-xs text-ink-soft" title={name}>
              {name}
            </span>

            {/* Hairline baseline, one step off the surface, that every bar
                grows from — present but recessive. */}
            <div className="relative border-l border-line-strong py-1">
              <div
                className="h-5 rounded-r-[4px] bg-brand-600 transition-[width] duration-300 group-hover:bg-brand-500"
                style={{ width: `${(value / peak) * 100}%` }}
              />

              <div
                role="tooltip"
                className="pointer-events-none absolute -top-1 left-2 z-10 hidden -translate-y-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs whitespace-nowrap text-ink-soft shadow-md group-hover:block"
              >
                <span className="font-semibold text-ink">{name}</span> · {row.visits} visits ·{' '}
                {row.meetings} meetings
              </div>
            </div>

            {/* Value at the tip, in a text token — never the series colour. */}
            <span className="text-xs text-ink-mute tabular-nums">{value}</span>
          </div>
        )
      })}
    </div>
  )
}
