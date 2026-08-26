import { Plus } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import type { EffectiveRole } from '@/api/types'
import { isProjectStaff } from '@/api/types'
import { useAuth } from '@/auth/AuthContext'
import { Ornament } from '@/components/Logo'
import {
  Button,
  Card,
  EmptyState,
  ErrorNote,
  KindBadge,
  RoleBadge,
  Spinner,
} from '@/components/ui'
import { ProjectMembersPanel } from '@/features/projects/ProjectMembersPanel'
import { useLogs, useProject, useProjectMembers } from '@/features/projects/queries'
import { cn, formatDate } from '@/lib/utils'

import { LogComposer } from './LogComposer'

type KindFilter = 'ALL' | 'MOV' | 'MOM'

export function ProjectTimelinePage() {
  const { slug = '' } = useParams()
  const { roleIn } = useAuth()
  const [kindFilter, setKindFilter] = useState<KindFilter>('ALL')
  const [composing, setComposing] = useState(false)

  const project = useProject(slug)
  const members = useProjectMembers(slug)
  const logs = useLogs({
    project: slug,
    kind: kindFilter === 'ALL' ? undefined : kindFilter,
  })

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
          <Button onClick={() => setComposing(true)}>
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
            onDone={() => setComposing(false)}
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
                onClick={() => setKindFilter(option)}
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
                  <Card>
                    <div className="flex flex-wrap items-center gap-2">
                      <KindBadge kind={log.kind} />
                      <h3 className="font-display text-lg font-semibold text-ink">{log.title}</h3>
                      {log.status === 'DRAFT' && (
                        <span className="rounded-full bg-paper-deep px-2 py-0.5 text-xs text-ink-soft">
                          Draft
                        </span>
                      )}
                    </div>

                    <p className="mt-1 text-xs text-ink-mute">
                      {formatDate(log.occurred_on)} · {log.author.full_name || log.author.email}
                      {log.location && ` · ${log.location}`}
                    </p>

                    <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">
                      {log.body}
                    </p>

                    {log.attendees.length > 0 && (
                      <p className="mt-3 border-t border-line pt-3 text-xs text-ink-mute">
                        Attendees: {log.attendees.map((a) => a.full_name || a.email).join(', ')}
                      </p>
                    )}
                  </Card>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  )
}
