import { Users } from 'lucide-react'
import { Link } from 'react-router-dom'

import type { EffectiveRole } from '@/api/types'
import { useAuth } from '@/auth/AuthContext'
import { Card, EmptyState, ErrorNote, RoleBadge, Spinner } from '@/components/ui'

import { useProjects } from './queries'

export function ProjectListPage() {
  const { user } = useAuth()
  const { data, isPending, error } = useProjects()

  if (isPending) return <Spinner label="Loading your projects…" />
  if (error) return <ErrorNote message={error.message} />

  const projects = data?.results ?? []

  if (projects.length === 0) {
    return (
      <EmptyState
        title="No projects yet"
        description={
          user?.is_exec
            ? 'Create a project from the Django admin to get started.'
            : 'You are signed in, but not part of any project yet. Ask a project lead to add you.'
        }
      />
    )
  }

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold text-slate-900">Your projects</h1>

      <div className="grid gap-4 sm:grid-cols-2">
        {projects.map((project) => (
          <Link
            key={project.id}
            to={`/projects/${project.slug}`}
            className="rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
          >
            <Card className="h-full transition-shadow hover:shadow-md">
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-medium text-slate-900">{project.name}</h2>
                {project.my_role && <RoleBadge role={project.my_role as EffectiveRole} />}
              </div>

              {project.description && (
                <p className="mt-2 line-clamp-2 text-sm text-slate-600">{project.description}</p>
              )}

              <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-500">
                <Users className="size-3.5" aria-hidden />
                {project.member_count} {project.member_count === 1 ? 'member' : 'members'}
              </p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
