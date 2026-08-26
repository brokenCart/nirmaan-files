import { Plus, Search, X } from 'lucide-react'
import { useDeferredValue, useId, useMemo, useState } from 'react'

import type { Membership, Project, Role, Semester } from '@/api/types'
import { ROLE_LABELS } from '@/api/types'
import { Button, Card, RoleBadge } from '@/components/ui'
import { cn } from '@/lib/utils'

import { AddMemberForm } from './AddMemberForm'

/** Roster order: seniority first, so the people to escalate to are at the top. */
const ROLE_RANK: Record<Role, number> = {
  LEAD: 0,
  FINANCE_LEAD: 1,
  VOLUNTEER: 2,
}

/** `Membership.role` is optional in the schema; rank those rows last. */
function rankOf(member: Membership) {
  return member.role ? ROLE_RANK[member.role] : ROLE_RANK.VOLUNTEER + 1
}

/**
 * The project roster, as the timeline's left rail.
 *
 * Filtering is client-side because `useProjectMembers` already holds the whole
 * roster — a project's membership is small enough to arrive in one page, and a
 * per-keystroke request would be slower than the array scan it replaces.
 *
 * `project` and `manageableTerm` together are the add affordance: both present
 * means the caller may write this term's roster. That judgement is the caller's
 * (`canManageRoster`); the panel renders what it is handed.
 */
export function ProjectMembersPanel({
  members,
  project,
  manageableTerm,
  className,
}: {
  members: Membership[]
  project?: Project
  /** The term a new member would join, when the caller may add one. */
  manageableTerm?: Semester | null
  className?: string
}) {
  const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState('')
  const searchId = useId()
  // Keeps typing responsive if a roster ever grows past what one scan can take.
  const deferredQuery = useDeferredValue(query)

  // Ordered once per roster change rather than per keystroke, since filtering
  // preserves order and the sort is the more expensive of the two.
  const ordered = useMemo(
    () =>
      [...members].sort(
        (a, b) =>
          rankOf(a) - rankOf(b) ||
          (a.user.full_name || a.user.email).localeCompare(b.user.full_name || b.user.email),
      ),
    [members],
  )

  const matches = useMemo(() => {
    const needle = deferredQuery.trim().toLowerCase()
    if (!needle) return ordered
    return ordered.filter((member) => {
      const role = member.role ? ROLE_LABELS[member.role] : ''
      return `${member.user.full_name} ${member.user.email} ${role}`
        .toLowerCase()
        .includes(needle)
    })
  }, [ordered, deferredQuery])

  const filtering = deferredQuery.trim().length > 0

  // Carries the narrowed values rather than being a boolean: `AddMemberForm`
  // requires both, and a boolean would not narrow the optional props for it.
  const addTarget = project && manageableTerm ? { project, semester: manageableTerm } : null

  return (
    <Card className={cn('p-4', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-display text-base font-semibold tracking-[-0.02em] text-ink">
          Members
        </h2>
        <span className="text-xs text-ink-mute tabular-nums">
          {filtering ? `${matches.length} of ${members.length}` : members.length}
        </span>
      </div>

      {addTarget &&
        (adding ? (
          <AddMemberForm {...addTarget} onDone={() => setAdding(false)} />
        ) : (
          <Button variant="secondary" className="mt-3 w-full" onClick={() => setAdding(true)}>
            <Plus className="size-4" aria-hidden />
            Add member
          </Button>
        ))}

      <div className={cn('relative mt-3', members.length === 0 && 'hidden')}>
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-mute"
          aria-hidden
        />
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search members"
          aria-label="Search members"
          className="w-full rounded-lg border-0 bg-paper/60 py-2 pr-9 pl-9 text-sm text-ink ring-1 ring-line-strong placeholder:text-ink-mute focus:bg-surface focus:ring-2 focus:ring-brand-600 [&::-webkit-search-cancel-button]:appearance-none"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label="Clear search"
            className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full p-1 text-ink-mute transition-colors hover:bg-gold-50 hover:text-brand-700"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        )}
      </div>

      {members.length === 0 ? (
        // Distinct from a search that found nothing: an empty roster is the
        // normal state of a term nobody has built yet, not a failed lookup.
        <p className="mt-4 text-sm text-ink-mute">Nobody is on the roster for this term yet.</p>
      ) : matches.length === 0 ? (
        <p className="mt-4 text-sm text-ink-mute">No members match “{deferredQuery.trim()}”.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {matches.map((member) => (
            <li key={member.id} className="flex items-center justify-between gap-2 py-2">
              {/* No wrapping: the name truncates so the badge stays on the
                  right of every row. `title` keeps the full name reachable. */}
              <span
                className="min-w-0 truncate text-sm text-ink-soft"
                title={member.user.full_name || member.user.email}
              >
                {member.user.full_name || member.user.email}
              </span>
              {member.role && <RoleBadge role={member.role} className="shrink-0" />}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
