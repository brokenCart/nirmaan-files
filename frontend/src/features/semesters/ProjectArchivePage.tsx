import { BarChart3, ScrollText } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'

import type { ArchiveTerm } from '@/api/types'
import { ProjectHeader } from '@/components/ProjectHeader'
import { Button, EmptyState, ErrorNote, SectionIntro, Spinner } from '@/components/ui'
import { useCurrentSemester, useProject, useProjectArchive } from '@/features/projects/queries'
import { formatDate } from '@/lib/utils'

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-3xl leading-none font-bold text-ink tabular-nums">{value}</div>
      <div className="mt-1 text-sm text-ink-mute">{label}</div>
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
    <div className="grid gap-x-8 gap-y-4 p-5 sm:grid-cols-[13rem_minmax(0,1fr)] sm:p-6">
      <div>
        <h3 className="flex flex-wrap items-center gap-2 text-2xl font-semibold text-ink">
          {semester.name}
          {isCurrent && (
            <span className="rounded bg-gold-50 px-2 py-0.5 font-sans text-sm font-medium text-gold-600 ring-1 ring-gold-100 ring-inset">
              Current
            </span>
          )}
        </h3>
        <p className="mt-1 text-sm text-ink-mute">
          {formatDate(semester.starts_on)} to {formatDate(semester.ends_on)}
        </p>
      </div>

      <div className="min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-wrap gap-8">
            <Stat label="Visits" value={term.visits} />
            <Stat label="Meetings" value={term.meetings} />
            <Stat label="Members" value={term.member_count} />
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

        <p className="mt-4 text-sm text-ink-soft">
          {leadNames.length > 0 ? (
            <>Led by {leadNames.join(', ')}</>
          ) : (
            <span className="text-ink-mute">No lead this semester.</span>
          )}
        </p>
      </div>
    </div>
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
    <div>
      <ProjectHeader project={project.data} />

      <div className="space-y-6">
        <SectionIntro
          title="Archive"
          description="Every semester of this project. Past semesters are read-only."
        />

        {archive.isPending ? (
          <Spinner label="Loading semesters…" />
        ) : archive.error ? (
          <ErrorNote message={archive.error.message} />
        ) : (archive.data?.length ?? 0) === 0 ? (
          <EmptyState
            title="No semesters yet"
            description="Semesters show up here once the project has members or entries."
          />
        ) : (
          <ol className="overflow-hidden rounded-[10px] border border-line bg-surface">
            {archive.data?.map((term) => (
              <li
                key={term.semester.id}
                className="border-b border-line last:border-0 even:bg-stripe"
              >
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
    </div>
  )
}
