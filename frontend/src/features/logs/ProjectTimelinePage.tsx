import { BarChart3, CalendarRange, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'

import { ApiError } from '@/api/client'
import type { EffectiveRole } from '@/api/types'
import { canDeleteLog, canEditLog, canManageRoster } from '@/api/types'
import { useAuth } from '@/auth/AuthContext'
import { Ornament } from '@/components/Logo'
import {
  Button,
  Card,
  EmptyState,
  ErrorNote,
  KindBadge,
  Pagination,
  RoleBadge,
  Spinner,
} from '@/components/ui'
import { ProjectMembersPanel } from '@/features/projects/ProjectMembersPanel'
import {
  LOGS_PAGE_SIZE,
  useCurrentSemester,
  useDeleteLog,
  useLogs,
  useProject,
  useProjectMembers,
  useSemesters,
} from '@/features/projects/queries'
import { SemesterSwitcher } from '@/features/semesters/SemesterSwitcher'
import { ALL_TERMS, isArchivedTerm } from '@/features/semesters/terms'
import { cn, formatDate } from '@/lib/utils'

import { CopyLogButton } from './CopyLogButton'
import { LogComposer } from './LogComposer'

type KindFilter = 'ALL' | 'MOV' | 'MOM'

export function ProjectTimelinePage() {
  const { slug = '' } = useParams()
  const { roleIn, user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [kindFilter, setKindFilter] = useState<KindFilter>('ALL')
  const [page, setPage] = useState(1)
  const [composing, setComposing] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<number | null>(null)
  const deleteLog = useDeleteLog()

  // The viewed term lives in the URL so a link into a past semester is
  // shareable; absent means the open term, which is what the API defaults to.
  const viewedTerm = searchParams.get('semester') ?? undefined

  const project = useProject(slug)
  const semesters = useSemesters()
  const currentSemester = useCurrentSemester()
  const members = useProjectMembers(slug, viewedTerm)
  const logs = useLogs({
    project: slug,
    kind: kindFilter === 'ALL' ? undefined : kindFilter,
    semester: viewedTerm,
    page,
  })

  const viewingArchive = isArchivedTerm(viewedTerm, currentSemester.data)

  function changeTerm(next: string | undefined) {
    setSearchParams(next ? { semester: next } : {}, { replace: true })
    // Terms hold different numbers of entries, and DRF 404s an out-of-range
    // page.
    setPage(1)
    setComposing(false)
    setEditingId(null)
  }

  const totalPages = Math.max(1, Math.ceil((logs.data?.count ?? 0) / LOGS_PAGE_SIZE))

  // A narrower filter can have fewer pages than the one being left, and DRF
  // 404s on an out-of-range page — so every filter change restarts at page 1.
  function changeFilter(next: KindFilter) {
    setKindFilter(next)
    setPage(1)
  }

  function changePage(next: number) {
    setPage(next)
    // Paging from the bottom of a long feed would otherwise land mid-list.
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function confirmDelete(id: number) {
    deleteLog.mutate(id, {
      onSuccess: () => {
        setConfirmingDeleteId(null)
        // Removing the last row of a trailing page would strand the reader on
        // an out-of-range page, which DRF answers with a 404.
        if (logs.data?.results.length === 1 && page > 1) setPage(page - 1)
      },
    })
  }

  const role = roleIn(slug)
  // The roster is a read for everyone the API already hands it to — any member
  // of any term, volunteers and archive-only viewers included. Undefined rather
  // than a boolean flag so the panel's prop stays narrowed, and an empty term
  // collapses the rail instead of rendering an empty card.
  const roster = members.data?.results.length ? members.data.results : undefined

  // Which term a new member would join. The `all` view spans every term and so
  // names none — it falls back to the open one, which the button then labels,
  // rather than leaving the affordance to guess.
  const viewedSemester =
    !viewedTerm || viewedTerm === ALL_TERMS
      ? currentSemester.data
      : semesters.data?.results.find((term) => term.slug === viewedTerm)

  const canAddMembers = canManageRoster(
    role,
    user?.is_exec ?? false,
    viewedSemester,
    currentSemester.data,
  )

  // An empty term still shows the rail when the caller can add to it — that is
  // precisely the term that needs a roster built, and hiding the panel until
  // someone is already on it would leave the lead no way in.
  const showRoster = roster !== undefined || canAddMembers

  if (project.isPending) return <Spinner label="Loading project…" />
  if (project.error) return <ErrorNote message={project.error.message} />
  if (!project.data) return <ErrorNote message="Project not found." />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/" className="text-sm text-ink-mute hover:text-brand-600">
            ← All projects
          </Link>
          <h1 className="mt-1 flex items-center gap-3 font-display text-2xl font-semibold text-ink">
            {project.data.name}
            {role ? (
              <RoleBadge role={role as EffectiveRole} />
            ) : (
              // No role this term: here on a past membership, and read-only.
              // Same marker the project list uses.
              <span className="inline-flex shrink-0 rounded-full bg-paper-deep px-2.5 py-0.5 text-xs font-semibold text-ink-mute ring-1 ring-line-strong ring-inset">
                Archive only
              </span>
            )}
          </h1>
          {project.data.description && (
            <p className="mt-1 max-w-2xl text-sm text-ink-soft">{project.data.description}</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            to={`/projects/${slug}/attendance${viewedTerm ? `?semester=${viewedTerm}` : ''}`}
          >
            <Button variant="secondary">
              <BarChart3 className="size-4" aria-hidden />
              Attendance
            </Button>
          </Link>

          <Link to={`/projects/${slug}/archive`}>
            <Button variant="secondary">
              <CalendarRange className="size-4" aria-hidden />
              Archive
            </Button>
          </Link>

          {/* Filing is only possible against the open term, so the button is
              absent rather than disabled on an archived one. */}
          {!composing && !viewingArchive && role && (
            <Button
              onClick={() => {
                setComposing(true)
                // One editor open at a time, so it is never ambiguous which
                // form a Save applies to.
                setEditingId(null)
              }}
            >
              <Plus className="size-4" aria-hidden />
              New entry
            </Button>
          )}
        </div>
      </div>

      {semesters.data && semesters.data.results.length > 1 && (
        <SemesterSwitcher
          semesters={semesters.data.results}
          value={viewedTerm}
          current={currentSemester.data}
          onChange={changeTerm}
        />
      )}

      {viewingArchive ? (
        <Card className="border-line-strong bg-paper-deep/40">
          <p className="text-sm text-ink-soft">
            You are reading a closed semester. Its entries are part of the project&rsquo;s record
            and cannot be edited or removed.
          </p>
        </Card>
      ) : (
        // The open term, but not on its roster — the one case where a reader
        // sees a live feed with no way to add to it. Say why, or the missing
        // compose box reads as a bug.
        !role && (
          <Card className="border-line-strong bg-paper-deep/40">
            <p className="text-sm text-ink-soft">
              You are not on this project&rsquo;s roster this semester. You can read the timeline
              and the archive, but adding, editing and removing entries is for current members.
            </p>
          </Card>
        )
      )}

      {composing && (
        <Card className="border-gold-500/40">
          <h2 className="font-display text-lg font-semibold text-brand-600">New timeline entry</h2>
          <Ornament className="mt-2 mb-5" />
          <LogComposer
            project={project.data}
            members={members.data?.results ?? []}
            semester={currentSemester.data}
            onDone={() => {
              setComposing(false)
              // A new entry sorts to the top of the feed, which is page 1.
              setPage(1)
            }}
          />
        </Card>
      )}

      <div
        className={cn(
          'grid gap-6',
          showRoster && 'lg:grid-cols-[16rem_minmax(0,1fr)] lg:items-start',
        )}
      >
        {showRoster && (
          // Last on a stacked layout — the timeline is what the page is for.
          <aside className="order-last lg:sticky lg:top-24 lg:order-first">
            <ProjectMembersPanel
              members={roster ?? []}
              project={canAddMembers ? project.data : undefined}
              manageableTerm={canAddMembers ? viewedSemester : undefined}
            />
          </aside>
        )}

        <div className="space-y-6">
          <div
            className="flex gap-1 rounded-full border border-line bg-surface p-1 sm:w-fit"
            role="group"
            aria-label="Filter by entry type"
          >
            {(['ALL', 'MOV', 'MOM'] as const).map((option) => (
              <Button
                key={option}
                variant={kindFilter === option ? 'primary' : 'ghost'}
                className="flex-1 px-5 sm:flex-none"
                onClick={() => changeFilter(option)}
              >
                {option === 'ALL' ? 'All' : option}
              </Button>
            ))}
          </div>

          {logs.isPending ? (
            <Spinner label="Loading timeline…" />
          ) : logs.error ? (
            <ErrorNote message={logs.error.message} />
          ) : (logs.data?.results.length ?? 0) === 0 ? (
            <EmptyState
              title="Nothing logged yet"
              description="Add the first MOV or MOM to start this project's record."
            />
          ) : (
            <ol className="space-y-3">
              {logs.data?.results.map((log) => (
                <li key={log.id}>
                  <Card className={cn(editingId === log.id && 'border-gold-500/40')}>
                    <div className="flex flex-wrap items-center gap-2">
                      <KindBadge kind={log.kind} />
                      <h3 className="font-display text-lg font-semibold text-ink">{log.title}</h3>
                      {log.status === 'DRAFT' && (
                        <span className="rounded-full bg-paper-deep px-2 py-0.5 text-xs text-ink-soft">
                          Draft
                        </span>
                      )}

                      {editingId !== log.id && confirmingDeleteId !== log.id && (
                        <div className="ml-auto flex gap-1">
                          <CopyLogButton log={log} />

                          {canEditLog(log, role, user?.id, currentSemester.data) && (
                            <Button
                              variant="ghost"
                              onClick={() => {
                                setEditingId(log.id)
                                setComposing(false)
                              }}
                            >
                              <Pencil className="size-4" aria-hidden />
                              Edit
                            </Button>
                          )}
                          {canDeleteLog(log, role, user?.id, currentSemester.data) && (
                            <Button
                              variant="ghost"
                              aria-label={`Remove “${log.title}” from the timeline`}
                              onClick={() => setConfirmingDeleteId(log.id)}
                            >
                              <Trash2 className="size-4" aria-hidden />
                              Delete
                            </Button>
                          )}
                        </div>
                      )}

                      {confirmingDeleteId === log.id && (
                        <div className="ml-auto flex items-center gap-2">
                          <span className="text-xs text-ink-soft">Remove from the timeline?</span>
                          <Button
                            variant="danger"
                            disabled={deleteLog.isPending}
                            onClick={() => confirmDelete(log.id)}
                          >
                            {deleteLog.isPending ? 'Removing…' : 'Remove'}
                          </Button>
                          <Button
                            variant="secondary"
                            disabled={deleteLog.isPending}
                            onClick={() => setConfirmingDeleteId(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      )}
                    </div>

                    {confirmingDeleteId === log.id && deleteLog.error && (
                      <div className="mt-3">
                        <ErrorNote
                          message={
                            deleteLog.error instanceof ApiError
                              ? deleteLog.error.detail
                              : deleteLog.error.message
                          }
                        />
                      </div>
                    )}

                    {editingId === log.id ? (
                      <div className="mt-4">
                        <LogComposer
                          project={project.data}
                          members={members.data?.results ?? []}
                          log={log}
                          semester={currentSemester.data}
                          onDone={() => setEditingId(null)}
                        />
                      </div>
                    ) : (
                      <>
                        <p className="mt-1 text-xs text-ink-mute">
                          {formatDate(log.occurred_on)} · {log.author.full_name || log.author.email}
                        </p>

                        <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">
                          {log.body}
                        </p>

                        {log.attendees.length > 0 && (
                          <p className="mt-3 border-t border-line pt-3 text-xs text-ink-mute">
                            Attendees: {log.attendees.map((a) => a.full_name || a.email).join(', ')}
                          </p>
                        )}
                      </>
                    )}
                  </Card>
                </li>
              ))}
            </ol>
          )}

          <Pagination
            page={page}
            totalPages={totalPages}
            onChange={changePage}
            label="Timeline pages"
            prevLabel="Newer"
            nextLabel="Older"
          />
        </div>
      </div>
    </div>
  )
}
