import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { ApiError } from '@/api/client'
import type { EffectiveRole } from '@/api/types'
import { canDeleteLog, canEditLog, isProjectStaff } from '@/api/types'
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
  useDeleteLog,
  useLogs,
  useProject,
  useProjectMembers,
} from '@/features/projects/queries'
import { cn, formatDate } from '@/lib/utils'

import { LogComposer } from './LogComposer'

type KindFilter = 'ALL' | 'MOV' | 'MOM'

export function ProjectTimelinePage() {
  const { slug = '' } = useParams()
  const { roleIn, user } = useAuth()
  const [kindFilter, setKindFilter] = useState<KindFilter>('ALL')
  const [page, setPage] = useState(1)
  const [composing, setComposing] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<number | null>(null)
  const deleteLog = useDeleteLog()

  const project = useProject(slug)
  const members = useProjectMembers(slug)
  const logs = useLogs({
    project: slug,
    kind: kindFilter === 'ALL' ? undefined : kindFilter,
    page,
  })

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
  // Undefined rather than a boolean flag so the panel's prop stays narrowed.
  const roster = isProjectStaff(role) ? members.data?.results : undefined

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
            {role && <RoleBadge role={role as EffectiveRole} />}
          </h1>
          {project.data.description && (
            <p className="mt-1 max-w-2xl text-sm text-ink-soft">{project.data.description}</p>
          )}
        </div>

        {!composing && (
          <Button
            onClick={() => {
              setComposing(true)
              // One editor open at a time, so it is never ambiguous which form
              // a Save applies to.
              setEditingId(null)
            }}
          >
            <Plus className="size-4" aria-hidden />
            New entry
          </Button>
        )}
      </div>

      {composing && (
        <Card className="border-gold-500/40">
          <h2 className="font-display text-lg font-semibold text-brand-600">New timeline entry</h2>
          <Ornament className="mt-2 mb-5" />
          <LogComposer
            project={project.data}
            members={members.data?.results ?? []}
            onDone={() => {
              setComposing(false)
              // A new entry sorts to the top of the feed, which is page 1.
              setPage(1)
            }}
          />
        </Card>
      )}

      <div
        className={cn('grid gap-6', roster && 'lg:grid-cols-[16rem_minmax(0,1fr)] lg:items-start')}
      >
        {roster && (
          // Last on a stacked layout — the timeline is what the page is for.
          <aside className="order-last lg:sticky lg:top-24 lg:order-first">
            <ProjectMembersPanel members={roster} />
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
                          {canEditLog(log, user?.id) && (
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
                          {canDeleteLog(log, role, user?.id) && (
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
