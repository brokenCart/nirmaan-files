import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useDeferredValue, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'

import { ApiError } from '@/api/client'
import type { Reimbursement, ReimbursementStatus } from '@/api/types'
import {
  REIMBURSEMENT_STATUSES,
  REIMBURSEMENT_STATUS_LABELS,
  canAddReimbursement,
  canDeleteReimbursement,
  canEditReimbursement,
  canReviewReimbursement,
} from '@/api/types'
import { useAuth } from '@/auth/AuthContext'
import { ProjectHeader } from '@/components/ProjectHeader'
import {
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Notice,
  Pagination,
  SearchField,
  SectionIntro,
  Spinner,
} from '@/components/ui'
import {
  REIMBURSEMENTS_PAGE_SIZE,
  useCurrentSemester,
  useDeleteReimbursement,
  useProject,
  useReimbursementSummary,
  useReimbursements,
  useSemesters,
} from '@/features/projects/queries'
import { PhotoGallery } from '@/features/photos/PhotoAttachments'
import { SemesterSwitcher } from '@/features/semesters/SemesterSwitcher'
import { isArchivedTerm } from '@/features/semesters/terms'
import { cn, formatDateTime, formatRupees } from '@/lib/utils'

import { ReimbursementForm } from './ReimbursementForm'
import { ReimbursementStatusBadge } from './ReimbursementStatusBadge'
import { ReviewControls } from './ReviewControls'

type StatusFilter = 'ALL' | ReimbursementStatus

const STATUS_FILTERS: StatusFilter[] = ['ALL', ...REIMBURSEMENT_STATUSES]

/**
 * A project's reimbursement queue.
 *
 * The one screen in the app whose *contents* differ by role rather than only
 * its buttons: the server returns a volunteer their own requests and a lead or
 * finance lead the project's whole queue. Nothing is filtered here — a client
 * that had to hide rows would be a client that had been sent them.
 *
 * That makes the heading ambiguous in a way no other screen's is ("is this
 * everything, or just mine?"), so the subtitle says which of the two the reader
 * is looking at rather than leaving them to infer it from the names.
 *
 * There *is* a term switcher here, unlike the resource shelf and the knowledge
 * base: a claim is an event, and its budget restarts each August, so the queue
 * is per term like the timeline.
 */
export function ProjectReimbursementsPage() {
  const { slug = '' } = useParams()
  const { roleIn, user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL')
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  // Typing stays responsive; the request follows the deferred value.
  const deferredSearch = useDeferredValue(search.trim())
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<number | null>(null)

  // The viewed term lives in the URL so a link into a past semester is
  // shareable; absent means the open term, which is what the API defaults to.
  const viewedTerm = searchParams.get('semester') ?? undefined

  const project = useProject(slug)
  const semesters = useSemesters()
  const currentSemester = useCurrentSemester()
  const filters = {
    status: statusFilter === 'ALL' ? undefined : statusFilter,
    semester: viewedTerm,
    // The summary takes this too, so the tab counts describe the search.
    q: deferredSearch || undefined,
    page,
  }
  const reimbursements = useReimbursements(slug, filters)
  const summary = useReimbursementSummary(slug, filters)
  const deleteReimbursement = useDeleteReimbursement(slug)

  const role = roleIn(slug)
  const isExec = user?.is_exec ?? false
  const viewingArchive = isArchivedTerm(viewedTerm, currentSemester.data)
  const canAdd = canAddReimbursement(role) && !viewingArchive
  // Whether this reader is being shown the project's queue or only their own
  // line of it — mirrors `QUEUE_ROLES` on the server.
  const seesWholeQueue = isExec || role === 'LEAD' || role === 'FINANCE_LEAD'

  const totalPages = Math.max(
    1,
    Math.ceil((reimbursements.data?.count ?? 0) / REIMBURSEMENTS_PAGE_SIZE),
  )

  function changeTerm(next: string | undefined) {
    setSearchParams(next ? { semester: next } : {}, { replace: true })
    // Terms hold different numbers of requests, and DRF 404s an out-of-range
    // page.
    setPage(1)
    setAdding(false)
    setEditingId(null)
  }

  // A narrower filter can have fewer pages than the one being left, and DRF
  // 404s on an out-of-range page — so every filter change restarts at page 1.
  function changeFilter(next: StatusFilter) {
    setStatusFilter(next)
    setPage(1)
  }

  function changeSearch(next: string) {
    setSearch(next)
    setPage(1)
  }

  function startAdding() {
    setAdding(true)
    // One editor open at a time, so it is never ambiguous which form a Save
    // applies to.
    setEditingId(null)
  }

  function startEditing(reimbursement: Reimbursement) {
    setEditingId(reimbursement.id)
    setAdding(false)
  }

  function confirmDelete(id: number) {
    deleteReimbursement.mutate(id, {
      onSuccess: () => {
        setConfirmingDeleteId(null)
        // Removing the last row of a trailing page would strand the reader on
        // an out-of-range page, which DRF answers with a 404.
        if (reimbursements.data?.results.length === 1 && page > 1) setPage(page - 1)
      },
    })
  }

  if (project.isPending) return <Spinner label="Loading project…" />
  if (project.error) return <ErrorNote message={project.error.message} />
  if (!project.data) return <ErrorNote message="Project not found." />

  const rows = reimbursements.data?.results ?? []

  return (
    <div>
      <ProjectHeader project={project.data} />

      <div className="space-y-6">
        <SectionIntro
          title="Reimbursements"
          description={
            seesWholeQueue
              ? 'Expense claims from this project’s members. The finance lead approves or rejects them.'
              : 'Your expense claims for this project. Only you and the project leads can see them.'
          }
          actions={
            !adding &&
            canAdd && (
              <Button onClick={startAdding}>
                <Plus className="size-4" aria-hidden />
                New request
              </Button>
            )
          }
        />

        {viewingArchive ? (
          <Notice>
            This semester is closed. Its requests can&rsquo;t be filed, edited or reviewed.
          </Notice>
        ) : (
          <>
            {!role && (
              <Notice>
                You&rsquo;re not a member this semester. You can see your past requests but
                can&rsquo;t file new ones.
              </Notice>
            )}

            {/* The one screen where LEAD and FINANCE_LEAD differ, so the absent
              Approve button gets an explanation rather than reading as a bug. */}
            {role === 'LEAD' && (
              <Notice>
                Only the finance lead can approve or reject requests. If there isn&rsquo;t one this
                semester, contact the Executive Committee.
              </Notice>
            )}
          </>
        )}

        {adding && (
          <Card className="border-brand-200">
            <h3 className="mb-5 text-xl font-semibold text-ink">New request</h3>
            <ReimbursementForm project={project.data} onDone={() => setAdding(false)} />
          </Card>
        )}

        {/* Counts come from `/summary/` rather than the page in hand: the list is
          paginated, so "3 awaiting review" must not become "2" on page two. */}
        <div className="flex flex-wrap items-center gap-3">
          <SearchField
            value={search}
            onChange={changeSearch}
            label="Search requests"
            placeholder="Search requests or people"
            className="w-full sm:w-72"
          />

          <div
            className="flex w-full gap-0.5 overflow-x-auto rounded-lg bg-paper-deep p-0.5 sm:w-fit"
            role="group"
            aria-label="Filter by status"
          >
            {STATUS_FILTERS.map((value) => {
              const bucket = value === 'ALL' ? undefined : summary.data?.[value]
              const count =
                value === 'ALL'
                  ? Object.values(summary.data ?? {}).reduce((sum, row) => sum + row.count, 0)
                  : bucket?.count

              return (
                <button
                  type="button"
                  key={value}
                  aria-pressed={statusFilter === value}
                  onClick={() => changeFilter(value)}
                  className={cn(
                    'inline-flex shrink-0 items-center gap-1.5 rounded-md px-3.5 py-1.5 text-sm font-medium whitespace-nowrap transition-colors',
                    statusFilter === value
                      ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(23,32,54,0.12)]'
                      : 'text-ink-soft hover:text-ink',
                  )}
                >
                  {value === 'ALL' ? 'All' : REIMBURSEMENT_STATUS_LABELS[value]}
                  {count !== undefined && (
                    <span className="text-sm text-ink-mute tabular-nums">{count}</span>
                  )}
                  {/* The total, on the tabs where it means something. "All" gets a
                  count only: approved, rejected and pending money summed
                  together is not a figure anyone has a use for. */}
                  {bucket !== undefined && bucket.count > 0 && (
                    <span className="text-sm text-ink-mute tabular-nums">
                      {formatRupees(bucket.total)}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

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

        {reimbursements.isPending ? (
          <Spinner label="Loading requests…" />
        ) : reimbursements.error ? (
          <ErrorNote message={reimbursements.error.message} />
        ) : rows.length === 0 ? (
          <EmptyState
            title={
              deferredSearch
                ? 'No requests match'
                : statusFilter === 'ALL'
                  ? 'No requests yet'
                  : 'Nothing here'
            }
            description={
              deferredSearch
                ? 'Try a different search, status or semester.'
                : statusFilter !== 'ALL'
                  ? `No requests in this term are ${REIMBURSEMENT_STATUS_LABELS[statusFilter].toLowerCase()}.`
                  : canAdd
                    ? 'Paid for something for the project? File a request to get the money back.'
                    : 'No requests this semester.'
            }
          />
        ) : (
          <ul
            className={cn(
              'overflow-hidden rounded-[10px] border border-line bg-surface',
              reimbursements.isPlaceholderData && 'opacity-60',
            )}
          >
            {rows.map((reimbursement) => {
              const editing = editingId === reimbursement.id
              const confirming = confirmingDeleteId === reimbursement.id
              const mine = reimbursement.submitted_by.id === user?.id
              const canReview = canReviewReimbursement(
                reimbursement,
                role,
                isExec,
                user?.id,
                currentSemester.data,
              )

              return (
                <li
                  key={reimbursement.id}
                  className={cn(
                    'border-b border-line p-5 last:border-0 even:bg-stripe',
                    editing && 'bg-gold-50 even:bg-gold-50',
                  )}
                >
                  {editing ? (
                    <>
                      <h3 className="mb-5 text-xl font-semibold text-ink">Edit request</h3>
                      <ReimbursementForm
                        project={project.data}
                        reimbursement={reimbursement}
                        onDone={() => setEditingId(null)}
                      />
                    </>
                  ) : (
                    <>
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <ReimbursementStatusBadge status={reimbursement.status} />
                          <h3 className="mt-2 text-xl font-semibold break-words text-ink">
                            {reimbursement.title}
                          </h3>
                        </div>
                        {/* Right-aligned tabular figures, so a column of
                            amounts lines up down the sheet — which is what
                            makes a queue scannable. */}
                        <span className="shrink-0 text-2xl leading-none font-bold text-ink tabular-nums">
                          {formatRupees(reimbursement.amount)}
                        </span>
                      </div>

                      <p className="mt-2 text-sm leading-relaxed whitespace-pre-wrap text-ink-soft">
                        {reimbursement.description}
                      </p>

                      <PhotoGallery
                        images={reimbursement.receipts}
                        title={reimbursement.title}
                        noun="Receipt"
                      />

                      <p className="mt-2 text-sm text-ink-mute">
                        {mine
                          ? 'Filed by you'
                          : `Filed by ${reimbursement.submitted_by.full_name || reimbursement.submitted_by.email}`}{' '}
                        on {formatDateTime(reimbursement.created_at)}
                      </p>

                      {/* The decision, once there is one. Shown to everyone who
                          can see the row — the volunteer's whole reason for
                          opening this screen is to read it. */}
                      {reimbursement.reviewed_by && reimbursement.reviewed_at && (
                        <div className="mt-3 rounded-md border-l-[3px] border-line-strong bg-paper/70 px-3 py-2.5">
                          <p className="text-sm text-ink-mute">
                            {REIMBURSEMENT_STATUS_LABELS[reimbursement.status]} by{' '}
                            {reimbursement.reviewed_by.full_name || reimbursement.reviewed_by.email}{' '}
                            on {formatDateTime(reimbursement.reviewed_at)}
                          </p>
                          {reimbursement.review_note && (
                            <p className="mt-1.5 text-sm leading-relaxed whitespace-pre-wrap text-ink-soft">
                              {reimbursement.review_note}
                            </p>
                          )}
                        </div>
                      )}

                      {canReview && (
                        <div className="mt-4">
                          <ReviewControls reimbursement={reimbursement} projectSlug={slug} />
                        </div>
                      )}

                      {/* A finance lead's own claim: they see the queue, and
                          this is the one row in it they cannot decide. Saying
                          so beats an unexplained gap where the buttons are. */}
                      {!canReview && mine && role === 'FINANCE_LEAD' && !viewingArchive && (
                        <p className="mt-3 text-sm text-ink-mute">
                          You can&rsquo;t review your own request. Ask another finance lead or the
                          Executive Committee.
                        </p>
                      )}

                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {!confirming && (
                          <div className="-ml-2 flex gap-1">
                            {canEditReimbursement(
                              reimbursement,
                              role,
                              user?.id,
                              currentSemester.data,
                            ) && (
                              <Button variant="ghost" onClick={() => startEditing(reimbursement)}>
                                <Pencil className="size-4" aria-hidden />
                                Edit
                              </Button>
                            )}
                            {canDeleteReimbursement(
                              reimbursement,
                              role,
                              isExec,
                              user?.id,
                              currentSemester.data,
                            ) && (
                              <Button
                                variant="ghost"
                                aria-label={`${mine ? 'Withdraw' : 'Remove'} “${reimbursement.title}”`}
                                onClick={() => setConfirmingDeleteId(reimbursement.id)}
                              >
                                <Trash2 className="size-4" aria-hidden />
                                {mine ? 'Withdraw' : 'Remove'}
                              </Button>
                            )}
                          </div>
                        )}

                        {confirming && (
                          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
                            <span className="text-sm text-ink-soft">
                              {mine ? 'Withdraw' : 'Remove'} this{' '}
                              {formatRupees(reimbursement.amount)} request?
                            </span>
                            <Button
                              variant="danger"
                              disabled={deleteReimbursement.isPending}
                              onClick={() => confirmDelete(reimbursement.id)}
                            >
                              {deleteReimbursement.isPending
                                ? 'Removing…'
                                : mine
                                  ? 'Withdraw'
                                  : 'Remove'}
                            </Button>
                            <Button
                              variant="secondary"
                              disabled={deleteReimbursement.isPending}
                              onClick={() => setConfirmingDeleteId(null)}
                            >
                              Cancel
                            </Button>
                          </div>
                        )}
                      </div>

                      {confirming && deleteReimbursement.error && (
                        <div className="mt-3">
                          <ErrorNote
                            message={
                              deleteReimbursement.error instanceof ApiError
                                ? deleteReimbursement.error.detail
                                : deleteReimbursement.error.message
                            }
                          />
                        </div>
                      )}
                    </>
                  )}
                </li>
              )
            })}
          </ul>
        )}

        <Pagination
          page={page}
          totalPages={totalPages}
          onChange={(next) => {
            setPage(next)
            window.scrollTo({ top: 0, behavior: 'smooth' })
          }}
          label="Reimbursement pages"
          prevLabel="Newer"
          nextLabel="Older"
        />
      </div>
    </div>
  )
}
