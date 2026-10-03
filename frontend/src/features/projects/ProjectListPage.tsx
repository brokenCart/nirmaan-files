import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'

import type { EffectiveRole } from '@/api/types'
import { useAuth } from '@/auth/AuthContext'
import { EmptyState, ErrorNote, RoleBadge, Spinner } from '@/components/ui'

import { useProjects } from './queries'

// The logo's four panel colours, cycled so each project row carries one.
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
            ? 'Create one in the Django admin.'
            : 'Ask a project lead to add you to their project.'
        }
      />
    )
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-4xl leading-[1.05] font-bold tracking-[-0.02em] text-ink sm:text-5xl">
          Your projects
        </h1>
        <p className="mt-3 text-ink-soft">
          {user?.is_exec
            ? 'All Nirmaan projects.'
            : 'Projects you’re on now or have been on before.'}
        </p>
      </div>

      <ul className="overflow-hidden rounded-[10px] border border-line bg-surface">
        {projects.map((project, index) => (
          <li key={project.id} className="border-b border-line last:border-0 even:bg-stripe">
            <Link
              to={`/projects/${project.slug}`}
              className="group grid grid-cols-[0.375rem_minmax(0,1fr)_auto] items-stretch gap-x-4 pr-4 transition-colors hover:bg-brand-100 focus-visible:outline-offset-[-2px] sm:gap-x-6 sm:pr-6"
            >
              <span className={SPINES[index % SPINES.length]} aria-hidden />

              <div className="min-w-0 py-5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <h2 className="text-2xl font-bold text-ink group-hover:text-brand-700">
                    {project.name}
                  </h2>
                  {project.my_role ? (
                    <RoleBadge role={project.my_role as EffectiveRole} />
                  ) : (
                    // Visible but no role this term: the project is here because
                    // of a past membership, and it is read-only.
                    <span className="inline-flex rounded px-2 py-0.5 text-sm font-medium text-ink-mute ring-1 ring-line-strong ring-inset">
                      Read only
                    </span>
                  )}
                </div>
                {project.description && (
                  <p className="mt-1.5 line-clamp-2 max-w-2xl text-sm text-ink-soft">
                    {project.description}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-3 text-sm text-ink-mute">
                <span className="hidden tabular-nums sm:inline">
                  {project.member_count} {project.member_count === 1 ? 'member' : 'members'}
                </span>
                <ChevronRight
                  className="size-5 text-line-strong transition-colors group-hover:text-brand-600"
                  aria-hidden
                />
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
