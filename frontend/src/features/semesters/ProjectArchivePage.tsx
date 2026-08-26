import { BarChart3, CalendarRange, ScrollText } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'

import type { ArchiveTerm } from '@/api/types'
import { Ornament } from '@/components/Logo'
import { Button, Card, EmptyState, ErrorNote, Spinner } from '@/components/ui'
import { useCurrentSemester, useProject, useProjectArchive } from '@/features/projects/queries'
import { formatDate } from '@/lib/utils'

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="font-display text-2xl font-semibold text-ink tabular-nums">{value}</div>
      <div className="text-xs tracking-wide text-ink-mute uppercase">{label}</div>
    </div>
  )
}

function TermCard({
  term,
  slug,
  isCurrent,
}: {
  term: ArchiveTerm
  slug: string
  isCurrent: boolean
}) {
  const { semester } = term
  const leadNames = term.leads.map((lead) => lead.full_name || lead.email)

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-brand-600">
            {semester.name}
            {isCurrent && (
              <span className="rounded-full bg-nirmaan-green/10 px-2 py-0.5 text-xs font-semibold text-nirmaan-green-ink ring-1 ring-nirmaan-green/20 ring-inset">
                Current
              </span>
            )}
          </h2>
          <p className="mt-1 text-xs text-ink-mute">
            {formatDate(semester.starts_on)} – {formatDate(semester.ends_on)}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link to={`/projects/${slug}?semester=${semester.slug}`}>
            <Button variant="secondary">
              <ScrollText className="size-4" aria-hidden />
              Timeline
            </Button>
          </Link>
          <Link to={`/projects/${slug}/attendance?semester=${semester.slug}`}>
            <Button variant="secondary">
              <BarChart3 className="size-4" aria-hidden />
              Attendance
            </Button>
          </Link>
        </div>
      </div>

      <Ornament className="mt-2 mb-5" />

      <div className="flex flex-wrap gap-8">
        <Stat label="Visits" value={term.visits} />
        <Stat label="Meetings" value={term.meetings} />
        <Stat label="Members" value={term.member_count} />
      </div>

      <p className="mt-4 border-t border-line pt-3 text-xs text-ink-mute">
        {leadNames.length > 0 ? (
          <>Led by {leadNames.join(', ')}</>
        ) : (
          <>No lead recorded for this semester.</>
        )}
      </p>
    </Card>
  )
}

/**
 * Every semester this project has a record in.
 *
 * The landing point for institutional memory: counts restart each term, so a
 * project's history is a list of terms rather than one running total. Open to
 * anyone who has ever been a member, including people who have since left —
 * which is the whole reason the archive is a separate screen from the
 * timeline's term switcher.
 */
export function ProjectArchivePage() {
  const { slug = '' } = useParams()
  const project = useProject(slug)
  const archive = useProjectArchive(slug)
  const currentSemester = useCurrentSemester()

  if (project.isPending) return <Spinner label="Loading project…" />
  if (project.error) return <ErrorNote message={project.error.message} />
  if (!project.data) return <ErrorNote message="Project not found." />

  return (
    <div className="space-y-6">
      <div>
        <Link to={`/projects/${slug}`} className="text-sm text-ink-mute hover:text-brand-600">
          ← {project.data.name} timeline
        </Link>
        <h1 className="mt-1 flex items-center gap-3 font-display text-2xl font-semibold text-ink">
          <CalendarRange className="size-6 text-brand-600" aria-hidden />
          Archive
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-soft">
          Every semester this project has a record in. Visits, meetings and the roster restart each
          term, so each row stands on its own. Past semesters are read-only.
        </p>
      </div>

      {archive.isPending ? (
        <Spinner label="Loading semesters…" />
      ) : archive.error ? (
        <ErrorNote message={archive.error.message} />
      ) : (archive.data?.length ?? 0) === 0 ? (
        <EmptyState
          title="Nothing archived yet"
          description="Once this project has entries or a roster, each semester will appear here."
        />
      ) : (
        <ol className="space-y-4">
          {archive.data?.map((term) => (
            <li key={term.semester.id}>
              <TermCard
                term={term}
                slug={slug}
                isCurrent={term.semester.id === currentSemester.data?.id}
              />
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
