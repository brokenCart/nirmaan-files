import { Plus } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import type { EffectiveRole } from '@/api/types'
import { isProjectStaff } from '@/api/types'
import { useAuth } from '@/auth/AuthContext'
import {
  Button,
  Card,
  EmptyState,
  ErrorNote,
  KindBadge,
  RoleBadge,
  Spinner,
} from '@/components/ui'
import { useLogs, useProject, useProjectMembers } from '@/features/projects/queries'
import { formatDate } from '@/lib/utils'

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

  if (project.isPending) return <Spinner label="Loading project…" />
  if (project.error) return <ErrorNote message={project.error.message} />
  if (!project.data) return <ErrorNote message="Project not found." />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/" className="text-sm text-slate-500 hover:text-slate-700">
            ← All projects
          </Link>
          <h1 className="mt-1 flex items-center gap-3 text-xl font-semibold text-slate-900">
            {project.data.name}
            {role && <RoleBadge role={role as EffectiveRole} />}
          </h1>
          {project.data.description && (
            <p className="mt-1 max-w-2xl text-sm text-slate-600">{project.data.description}</p>
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
        <Card>
          <h2 className="mb-4 font-medium text-slate-900">New timeline entry</h2>
          <LogComposer
            project={project.data}
            members={members.data?.results ?? []}
            onDone={() => setComposing(false)}
          />
        </Card>
      )}

      <div className="flex gap-1" role="group" aria-label="Filter by entry type">
        {(['ALL', 'MOV', 'MOM'] as const).map((option) => (
          <Button
            key={option}
            variant={kindFilter === option ? 'primary' : 'secondary'}
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
                  <h3 className="font-medium text-slate-900">{log.title}</h3>
                  {log.status === 'DRAFT' && (
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                      Draft
                    </span>
                  )}
                </div>

                <p className="mt-1 text-xs text-slate-500">
                  {formatDate(log.occurred_on)} · {log.author.full_name || log.author.email}
                  {log.location && ` · ${log.location}`}
                </p>

                <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">{log.body}</p>

                {log.attendees.length > 0 && (
                  <p className="mt-3 text-xs text-slate-500">
                    Attendees:{' '}
                    {log.attendees.map((a) => a.full_name || a.email).join(', ')}
                  </p>
                )}
              </Card>
            </li>
          ))}
        </ol>
      )}

      {isProjectStaff(role) && members.data && (
        <Card>
          <h2 className="mb-3 font-medium text-slate-900">
            Members ({members.data.results.length})
          </h2>
          <ul className="divide-y divide-slate-100">
            {members.data.results.map((member) => (
              <li key={member.id} className="flex items-center justify-between gap-3 py-2">
                <span className="text-sm text-slate-700">
                  {member.user.full_name || member.user.email}
                </span>
                {member.role && <RoleBadge role={member.role} />}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
