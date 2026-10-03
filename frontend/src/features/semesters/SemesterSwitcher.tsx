import { Archive, CalendarRange } from 'lucide-react'
import { Link } from 'react-router-dom'

import type { Semester } from '@/api/types'
import { Select } from '@/components/ui'

import { ALL_TERMS, isArchivedTerm } from './terms'

/**
 * Term picker for the timeline and attendance screens.
 *
 * The selected term is the URL's `?semester=` slug, so a link into a past
 * semester is shareable and survives a reload — a screen that is showing last
 * year's numbers must say so in the address bar, not just in component state.
 */
export function SemesterSwitcher({
  semesters,
  value,
  current,
  onChange,
  includeAll = false,
  archiveHref,
}: {
  semesters: Semester[]
  /** Selected slug, or undefined for the open term. */
  value: string | undefined
  current: Semester | null | undefined
  onChange: (slug: string | undefined) => void
  includeAll?: boolean
  archiveHref?: string
}) {
  const selected = value ?? current?.slug ?? ''
  const archived = isArchivedTerm(value, current)

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-2 text-sm text-ink-soft">
        <CalendarRange className="size-4" aria-hidden />
        <span className="sr-only sm:not-sr-only">Semester</span>
        <Select
          className="w-auto min-w-56 py-1.5"
          value={value === ALL_TERMS ? ALL_TERMS : selected}
          onChange={(event) => {
            const next = event.target.value
            // The open term is the default, so it is represented by dropping
            // the parameter rather than by spelling it out in every URL.
            onChange(next === current?.slug ? undefined : next)
          }}
        >
          {includeAll && <option value={ALL_TERMS}>All semesters</option>}
          {semesters.map((semester) => (
            <option key={semester.id} value={semester.slug}>
              {semester.name}
              {semester.id === current?.id ? ' (current)' : ''}
            </option>
          ))}
        </Select>
      </label>

      {archived && (
        <span className="inline-flex items-center gap-1.5 rounded bg-gold-50 px-2 py-1 text-sm font-medium text-gold-600 ring-1 ring-gold-100 ring-inset">
          <Archive className="size-3.5" aria-hidden />
          Read only
        </span>
      )}

      {archiveHref && (
        <Link to={archiveHref} className="text-sm text-ink-mute hover:text-brand-600">
          View archive
        </Link>
      )}
    </div>
  )
}
