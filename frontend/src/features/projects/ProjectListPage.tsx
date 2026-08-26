import { Users } from 'lucide-react'
import { Link } from 'react-router-dom'

import type { EffectiveRole } from '@/api/types'
import { useAuth } from '@/auth/AuthContext'
import { Ornament } from '@/components/Logo'
import { Card, EmptyState, ErrorNote, RoleBadge, Spinner } from '@/components/ui'

import { useProjects } from './queries'

// The logo's four panel colours, cycled so each project card carries one.
const SPINES = ['bg-nirmaan-blue', 'bg-nirmaan-gold', 'bg-nirmaan-red', 'bg-nirmaan-green']

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
      <div className="mb-6 text-center">
        <h1 className="font-display text-2xl font-semibold text-ink">Your projects</h1>
        <Ornament className="mt-2" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {projects.map((project, index) => (
          <Link
            key={project.id}
            to={`/projects/${project.slug}`}
            className="rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
          >
            <Card className="relative h-full overflow-hidden pl-6 transition-shadow hover:shadow-[0_1px_2px_rgba(47,29,22,0.06),0_16px_32px_-18px_rgba(47,29,22,0.45)]">
              <span
                className={`absolute inset-y-0 left-0 w-1.5 ${SPINES[index % SPINES.length]}`}
                aria-hidden
              />

              <div className="flex items-start justify-between gap-3">
                <h2 className="font-display text-lg font-semibold text-ink">{project.name}</h2>
                {project.my_role ? (
                  <RoleBadge role={project.my_role as EffectiveRole} />
                ) : (
                  // Visible but no role this term: the project is here because
                  // of a past membership, and it is read-only.
                  <span className="inline-flex shrink-0 rounded-full bg-paper-deep px-2.5 py-0.5 text-xs font-semibold text-ink-mute ring-1 ring-line-strong ring-inset">
                    Archive only
                  </span>
                )}
              </div>

              {project.description && (
                <p className="mt-2 line-clamp-2 text-sm text-ink-soft">{project.description}</p>
              )}

              <p className="mt-4 flex items-center gap-1.5 text-xs text-ink-mute">
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
