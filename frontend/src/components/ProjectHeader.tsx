import { NavLink, useSearchParams } from 'react-router-dom'

import type { Project } from '@/api/types'
import { useAuth } from '@/auth/AuthContext'
import { RoleBadge } from '@/components/ui'
import { cn } from '@/lib/utils'

/**
 * The project's name and its section tabs, shared by every project screen.
 *
 * Tabs for the per-term screens — timeline, attendance, reimbursements — carry
 * the viewed `?semester=` across, so moving between them keeps the term in
 * view. Resources and knowledge do not: both shelves belong to no term, and
 * carrying the parameter would promise a filter that does not exist.
 */
export function ProjectHeader({ project }: { project: Project }) {
  const { roleIn } = useAuth()
  const [searchParams] = useSearchParams()
  const role = roleIn(project.slug)
  const term = searchParams.get('semester')
  const termQuery = term ? `?semester=${term}` : ''
  const base = `/projects/${project.slug}`

  const tabs = [
    { to: `${base}${termQuery}`, label: 'Timeline', end: true },
    { to: `${base}/attendance${termQuery}`, label: 'Attendance' },
    { to: `${base}/knowledge`, label: 'Knowledge' },
    { to: `${base}/resources`, label: 'Resources' },
    { to: `${base}/reimbursements${termQuery}`, label: 'Reimbursements' },
    { to: `${base}/archive`, label: 'Archive' },
  ]

  return (
    // A band in the logo's navy, so the project name is the highest-contrast
    // thing on the page and the four-colour rule underneath ties it to the mark.
    <header className="mb-8 overflow-hidden rounded-xl bg-navy text-white">
      <div className="px-5 pt-5 sm:px-8 sm:pt-7">
        <NavLink
          to="/"
          className="text-sm font-medium text-white/80 hover:text-white hover:underline"
        >
          All projects
        </NavLink>

        <div className="mt-2 flex flex-wrap items-end gap-x-4 gap-y-2">
          <h1 className="text-4xl leading-[1.05] font-bold tracking-[-0.02em] text-white sm:text-5xl">
            {project.name}
          </h1>
          <div className="pb-1.5">
            {role ? (
              <RoleBadge role={role} className="bg-white text-navy ring-white" />
            ) : (
              // No role this term: here on a past membership, and read-only.
              <span className="inline-flex rounded px-2 py-0.5 text-sm font-medium text-white ring-1 ring-white/50 ring-inset">
                Read only
              </span>
            )}
          </div>
        </div>

        {project.description && (
          <p className="mt-3 max-w-2xl text-white/90">{project.description}</p>
        )}

        <nav
          aria-label={`${project.name} sections`}
          className="-mx-5 mt-5 overflow-x-auto px-5 pb-5 sm:-mx-8 sm:px-8 sm:pb-6"
        >
          <ul className="-ml-4 flex gap-1">
            {tabs.map((tab) => (
              <li key={tab.label} className="shrink-0">
                <NavLink
                  to={tab.to}
                  end={tab.end}
                  className={({ isActive }) =>
                    // A filled pill, clear of the four-colour rule below it. An
                    // underline sat on the rule and read as a fifth stripe.
                    cn(
                      'block rounded-full px-4 py-1.5 transition-colors',
                      isActive
                        ? 'bg-white font-semibold text-navy'
                        : 'font-medium text-white/80 hover:bg-white/10 hover:text-white',
                    )
                  }
                >
                  {tab.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <div className="nirmaan-rule h-1.5" aria-hidden />
    </header>
  )
}
