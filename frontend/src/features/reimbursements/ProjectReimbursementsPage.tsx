import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'

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
import { Ornament } from '@/components/Logo'
import { Button, Card, EmptyState, ErrorNote, Pagination, Spinner } from '@/components/ui'
import {
  REIMBURSEMENTS_PAGE_SIZE,
  useCurrentSemester,
  useDeleteReimbursement,
  useProject,
  useReimbursementSummary,
  useReimbursements,
  useSemesters,
} from '@/features/projects/queries'
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
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to={`/projects/${slug}`} className="text-sm text-ink-mute hover:text-brand-600">
            ← {project.data.name} timeline
          </Link>
          <h1 className="mt-1 font-display text-2xl font-semibold text-ink">Reimbursements</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-soft">
            {seesWholeQueue
              ? 'Money claimed back by this project’s volunteers. The finance lead approves or turns down each request.'
              : 'What you have claimed back from this project, and where each request has got to. Only you and the project’s leads can see these.'}
          </p>
        </div>

        {!adding && canAdd && (
          <Button onClick={startAdding}>
            <Plus className="size-4" aria-hidden />
            New request
          </Button>
        )}
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
            You are reading a closed semester. Its requests are part of the project&rsquo;s
            record — they cannot be filed, edited or reviewed now.
          </p>
        </Card>
      ) : (
        <>
          {!role && (
            <Card className="border-line-strong bg-paper-deep/40">
              <p className="text-sm text-ink-soft">
                You are not on this project&rsquo;s roster this semester. You can still see what
                you claimed while you were, but not file anything new.
              </p>
            </Card>
          )}

          {/* The one screen where LEAD and FINANCE_LEAD differ, so the absent
              Approve button gets an explanation rather than reading as a bug. */}
          {role === 'LEAD' && (
            <Card className="border-line-strong bg-paper-deep/40">
              <p className="text-sm text-ink-soft">
                You can see everything claimed against this project. Approving and rejecting is
                the finance lead&rsquo;s — ask the Executive Committee if there isn&rsquo;t one
                this semester.
              </p>
            </Card>
          )}
        </>
      )}

      {adding && (
        <Card className="border-gold-500/40">
          <h2 className="font-display text-lg font-semibold text-brand-600">New request</h2>
          <Ornament className="mt-2 mb-5" />
          <ReimbursementForm project={project.data} onDone={() => setAdding(false)} />
        </Card>
      )}

      {/* Counts come from `/summary/` rather than the page in hand: the list is
          paginated, so "3 awaiting review" must not become "2" on page two. */}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by status">
        {STATUS_FILTERS.map((value) => {
          const bucket = value === 'ALL' ? undefined : summary.data?.[value]
          const count =
            value === 'ALL'
              ? Object.values(summary.data ?? {}).reduce((sum, row) => sum + row.count, 0)
              : bucket?.count

          return (
            <Button
              key={value}
              variant={statusFilter === value ? 'primary' : 'secondary'}
              aria-pressed={statusFilter === value}
              onClick={() => changeFilter(value)}
            >
              {value === 'ALL' ? 'All' : REIMBURSEMENT_STATUS_LABELS[value]}
              {count !== undefined && (
                <span className="text-xs tabular-nums opacity-70">{count}</span>
              )}
              {/* The total, on the tabs where it means something. "All" gets a
                  count only: approved, rejected and pending money summed
                  together is not a figure anyone has a use for. */}
              {bucket !== undefined && bucket.count > 0 && (
                <span className="text-xs tabular-nums opacity-70">
                  · {formatRupees(bucket.total)}
                </span>
              )}
            </Button>
          )
        })}
      </div>

      {reimbursements.isPending ? (
        <Spinner label="Loading requests…" />
      ) : reimbursements.error ? (
        <ErrorNote message={reimbursements.error.message} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={statusFilter === 'ALL' ? 'No requests yet' : 'Nothing here'}
          description={
            statusFilter !== 'ALL'
              ? `No requests in this term are ${REIMBURSEMENT_STATUS_LABELS[statusFilter].toLowerCase()}.`
              : canAdd
                ? 'Spent your own money on the project? File it here and the finance lead will pick it up.'
                : 'Nothing has been claimed against this project this semester.'
          }
        />
      ) : (
        <ul className="space-y-3">
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
              <li key={reimbursement.id}>
                <Card className={cn(editing && 'border-gold-500/40')}>
                  {editing ? (
                    <>
                      <h2 className="font-display text-lg font-semibold text-brand-600">
                        Edit request
                      </h2>
                      <Ornament className="mt-2 mb-5" />
                      <ReimbursementForm
                        project={project.data}
                        reimbursement={reimbursement}
                        onDone={() => setEditingId(null)}
                      />
                    </>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        <ReimbursementStatusBadge status={reimbursement.status} />
                        <h2 className="min-w-0 font-display text-lg font-semibold break-words text-ink">
                          {reimbursement.title}
                        </h2>
                        {/* Tabular figures so a column of amounts lines up on
                            the decimal, which is what makes a queue scannable. */}
                        <span className="font-display text-lg font-semibold text-brand-700 tabular-nums">
                          {formatRupees(reimbursement.amount)}
                        </span>

                        {!confirming && (
                          <div className="ml-auto flex gap-1">
                            {canEditReimbursement(
                              reimbursement,
                              role,
                              user?.id,
                              currentSemester.data,
                            ) && (
                              <Button
                                variant="ghost"
                                onClick={() => startEditing(reimbursement)}
                              >
                                <Pencil className="size-4" aria-hidden />
                                Edit
                              </Button>
                            )}
                            {canDeleteReimbursement(
                              reimbursement,
                              role,
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
                          <div className="ml-auto flex items-center gap-2">
                            <span className="text-xs text-ink-soft">
                              {mine ? 'Withdraw' : 'Remove'} this {formatRupees(reimbursement.amount)}{' '}
                              request?
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

                      <p className="mt-2 text-sm leading-relaxed whitespace-pre-wrap text-ink-soft">
                        {reimbursement.description}
                      </p>

                      <p className="mt-3 text-xs text-ink-mute">
                        {mine
                          ? 'Filed by you'
                          : `Filed by ${reimbursement.submitted_by.full_name || reimbursement.submitted_by.email}`}{' '}
                        · {formatDateTime(reimbursement.created_at)}
                      </p>

                      {/* The decision, once there is one. Shown to everyone who
                          can see the row — the volunteer's whole reason for
                          opening this screen is to read it. */}
                      {reimbursement.reviewed_by && reimbursement.reviewed_at && (
                        <div className="mt-3 rounded-lg bg-paper-deep/40 p-3 ring-1 ring-line">
                          <p className="text-xs text-ink-mute">
                            {REIMBURSEMENT_STATUS_LABELS[reimbursement.status]} by{' '}
                            {reimbursement.reviewed_by.full_name ||
                              reimbursement.reviewed_by.email}{' '}
                            · {formatDateTime(reimbursement.reviewed_at)}
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
                          <ReviewControls
                            reimbursement={reimbursement}
                            projectSlug={slug}
                          />
                        </div>
                      )}

                      {/* A finance lead's own claim: they see the queue, and
                          this is the one row in it they cannot decide. Saying
                          so beats an unexplained gap where the buttons are. */}
                      {!canReview && mine && role === 'FINANCE_LEAD' && !viewingArchive && (
                        <p className="mt-3 text-xs text-ink-mute">
                          You cannot review your own request — ask another finance lead or the
                          Executive Committee.
                        </p>
                      )}
                    </>
                  )}
                </Card>
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
  )
}
