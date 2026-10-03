import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useDeferredValue, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'

import { ApiError } from '@/api/client'
import { canDeleteLog, canEditLog, canManageRoster, canRemoveMember } from '@/api/types'
import { useAuth } from '@/auth/AuthContext'
import { ProjectHeader } from '@/components/ProjectHeader'
import {
  Button,
  Card,
  EmptyState,
  ErrorNote,
  KindBadge,
  Notice,
  Pagination,
  SearchField,
  Segmented,
  SectionIntro,
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
import { cn, dateParts } from '@/lib/utils'

import { CopyLogButton } from './CopyLogButton'
import { LogComposer } from './LogComposer'

type KindFilter = 'ALL' | 'MOV' | 'MOM'

export function ProjectTimelinePage() {
  const { slug = '' } = useParams()
  const { roleIn, user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [kindFilter, setKindFilter] = useState<KindFilter>('ALL')
  const [search, setSearch] = useState('')
  // Typing stays responsive; the request follows the deferred value.
  const deferredSearch = useDeferredValue(search.trim())
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
    q: deferredSearch || undefined,
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

  // Same reason as `changeFilter`: fewer matches can mean fewer pages.
  function changeSearch(next: string) {
    setSearch(next)
    setPage(1)
  }

  const filtering = deferredSearch.length > 0 || kindFilter !== 'ALL'

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
    <div>
      <ProjectHeader project={project.data} />

      <div className="space-y-6">
        <SectionIntro
          title="Timeline"
          description="Visits (MOV) and meetings (MOM), newest first."
          actions={
            // Filing is only possible against the open term, so the button is
            // absent rather than disabled on an archived one.
            !composing &&
            !viewingArchive &&
            role && (
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
            )
          }
        />

        <div className="flex flex-wrap items-center gap-3">
          <SearchField
            value={search}
            onChange={changeSearch}
            label="Search entries"
            placeholder="Search entries or people"
            className="w-full sm:w-72"
          />

          <Segmented
            options={['ALL', 'MOV', 'MOM'] as const}
            value={kindFilter}
            onChange={changeFilter}
            label="Filter by entry type"
            renderLabel={(option) =>
              option === 'ALL' ? 'All entries' : option === 'MOV' ? 'Visits' : 'Meetings'
            }
          />

          {semesters.data && semesters.data.results.length > 1 && (
            <div className="sm:ml-auto">
              <SemesterSwitcher
                semesters={semesters.data.results}
                value={viewedTerm}
                current={currentSemester.data}
                onChange={changeTerm}
              />
            </div>
          )}
        </div>

        {deferredSearch && logs.data && logs.data.count > 0 && (
          <p aria-live="polite" className="text-sm text-ink-soft">
            {logs.data.count} {logs.data.count === 1 ? 'entry matches' : 'entries match'} &ldquo;
            {deferredSearch}&rdquo; in this semester.
          </p>
        )}

        {viewingArchive ? (
          <Notice>This semester is closed. Its entries can&rsquo;t be changed.</Notice>
        ) : (
          // The open term, but not on its roster — the one case where a reader
          // sees a live feed with no way to add to it. Say why, or the missing
          // compose box reads as a bug.
          !role && (
            <Notice>
              You&rsquo;re not a member this semester, so you can read entries but not add or edit
              them.
            </Notice>
          )
        )}

        {composing && (
          <Card className="border-brand-200">
            <h3 className="mb-5 text-xl font-semibold text-ink">New timeline entry</h3>
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
            // 19rem, not 16: the roster carries full names next to a role
            // badge, and the narrower rail truncated most of them.
            showRoster && 'lg:grid-cols-[minmax(0,1fr)_19rem] lg:items-start',
          )}
        >
          <div className="space-y-4">
            {logs.isPending ? (
              <Spinner label="Loading timeline…" />
            ) : logs.error ? (
              <ErrorNote message={logs.error.message} />
            ) : (logs.data?.results.length ?? 0) === 0 ? (
              <EmptyState
                title={filtering ? 'No entries match' : 'No entries yet'}
                description={
                  filtering
                    ? 'Try a different search, filter or semester.'
                    : 'Add a visit or meeting to get started.'
                }
              />
            ) : (
              // The register: one sheet, a ruled row per entry, the date in a
              // gutter of its own so the feed scans by when as well as what.
              <ol
                className={cn(
                  'overflow-hidden rounded-[10px] border border-line bg-surface',
                  logs.isPlaceholderData && 'opacity-60',
                )}
              >
                {logs.data?.results.map((log) => {
                  const date = dateParts(log.occurred_on)
                  return (
                    <li
                      key={log.id}
                      className={cn(
                        // Alternate rows tinted so consecutive entries separate.
                        'grid grid-cols-[3.75rem_minmax(0,1fr)] border-b border-line last:border-0 even:bg-stripe sm:grid-cols-[5.5rem_minmax(0,1fr)]',
                        editingId === log.id && 'bg-gold-50 even:bg-gold-50',
                      )}
                    >
                      <div className="border-r border-line px-2 py-5 text-center">
                        <time dateTime={log.occurred_on} className="block">
                          <span className="block text-2xl leading-none font-bold text-ink tabular-nums sm:text-3xl">
                            {date.day}
                          </span>
                          <span className="mt-1 block text-sm text-ink-mute">
                            {date.month} {date.year}
                          </span>
                        </time>
                      </div>

                      <div className="min-w-0 p-4 sm:p-5">
                        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                          <KindBadge kind={log.kind} />
                          <h3 className="min-w-0 text-xl font-semibold break-words text-ink">
                            {log.title}
                          </h3>
                          {log.status === 'DRAFT' && (
                            <span className="rounded border border-dashed border-line-strong px-1.5 py-0.5 text-sm text-ink-mute">
                              Draft
                            </span>
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
                            <p className="mt-1 text-sm text-ink-mute">
                              By {log.author.full_name || log.author.email}
                            </p>

                            <p className="mt-3 max-w-[70ch] text-[0.95rem] leading-relaxed whitespace-pre-wrap text-ink-soft">
                              {log.body}
                            </p>

                            {log.attendees.length > 0 && (
                              // The names are content, not chrome — visit and
                              // meeting counts are derived from this list, so
                              // it is the part of an entry people check.
                              <p className="mt-3 text-sm leading-relaxed text-ink-soft">
                                <span className="text-ink-mute">
                                  {log.attendees.length} present:{' '}
                                </span>
                                {log.attendees.map((a) => a.full_name || a.email).join(', ')}
                              </p>
                            )}

                            {confirmingDeleteId === log.id ? (
                              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
                                <span className="text-sm text-ink-soft">
                                  Remove from the timeline?
                                </span>
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
                            ) : (
                              <div className="-ml-2 mt-3 flex flex-wrap gap-1">
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
                          </>
                        )}
                      </div>
                    </li>
                  )
                })}
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

          {showRoster && (
            <aside className="lg:sticky lg:top-24">
              <ProjectMembersPanel
                members={roster ?? []}
                project={project.data}
                manageableTerm={canAddMembers ? viewedSemester : undefined}
                canRemove={(member) =>
                  canRemoveMember(
                    member,
                    role,
                    user?.is_exec ?? false,
                    viewedSemester,
                    currentSemester.data,
                    user?.id,
                  )
                }
              />
            </aside>
          )}
        </div>
      </div>
    </div>
  )
}
