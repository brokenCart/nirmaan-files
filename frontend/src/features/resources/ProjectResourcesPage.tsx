import { ExternalLink, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { ApiError } from '@/api/client'
import type { Resource } from '@/api/types'
import { canAddResource, canChangeResource } from '@/api/types'
import { useAuth } from '@/auth/AuthContext'
import { Ornament } from '@/components/Logo'
import { Button, Card, EmptyState, ErrorNote, Spinner } from '@/components/ui'
import { useDeleteResource, useProject, useResources } from '@/features/projects/queries'
import { cn } from '@/lib/utils'

import { ResourceForm } from './ResourceForm'
import { ResourceKindBadge } from './ResourceKindBadge'

/**
 * The host a link points at, for the line under its name.
 *
 * Wrapped because `URL` throws on anything it cannot parse, and the shelf must
 * still render rows that predate the scheme rule or were written straight into
 * the database.
 */
function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

/**
 * A project's shelf of links.
 *
 * There is no term switcher here, and its absence is the feature: a resource
 * points at something that exists now, so the shelf does not restart each
 * semester the way the timeline and the roster do. What still stops at the
 * term boundary is the person — a past member reads the shelf and adds nothing.
 *
 * The project's Drive folder is one of these rows, with `kind: 'FOLDER'`. It
 * used to be a field on the project and is not any more: one shelf that holds
 * every link beats a shelf plus a special case that only the admin could set.
 */
export function ProjectResourcesPage() {
  const { slug = '' } = useParams()
  const { roleIn, user } = useAuth()
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<number | null>(null)

  const project = useProject(slug)
  const resources = useResources(slug)
  const deleteResource = useDeleteResource(slug)

  const role = roleIn(slug)
  const isExec = user?.is_exec ?? false
  const canAdd = canAddResource(role)

  function startAdding() {
    setAdding(true)
    // One editor open at a time, so it is never ambiguous which form a Save
    // applies to.
    setEditingId(null)
  }

  function startEditing(resource: Resource) {
    setEditingId(resource.id)
    setAdding(false)
  }

  if (project.isPending) return <Spinner label="Loading project…" />
  if (project.error) return <ErrorNote message={project.error.message} />
  if (!project.data) return <ErrorNote message="Project not found." />

  const rows = resources.data ?? []

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to={`/projects/${slug}`} className="text-sm text-ink-mute hover:text-brand-600">
            ← {project.data.name} timeline
          </Link>
          <h1 className="mt-1 font-display text-2xl font-semibold text-ink">Resources</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-soft">
            Where this project&rsquo;s files live — Drive folders, plans, forms. The links are
            kept here; access to what they point at is still Drive&rsquo;s to grant.
          </p>
        </div>

        {!adding && canAdd && (
          <Button onClick={startAdding}>
            <Plus className="size-4" aria-hidden />
            Add link
          </Button>
        )}
      </div>

      {!role && (
        <Card className="border-line-strong bg-paper-deep/40">
          <p className="text-sm text-ink-soft">
            You are not on this project&rsquo;s roster this semester. You can open its links, but
            adding and changing them is for current members.
          </p>
        </Card>
      )}

      {adding && (
        <Card className="border-gold-500/40">
          <h2 className="font-display text-lg font-semibold text-brand-600">New link</h2>
          <Ornament className="mt-2 mb-5" />
          <ResourceForm project={project.data} onDone={() => setAdding(false)} />
        </Card>
      )}

      {resources.isPending ? (
        <Spinner label="Loading resources…" />
      ) : resources.error ? (
        <ErrorNote message={resources.error.message} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No links yet"
          description={
            canAdd
              ? "Add the Drive folder, the term plan, the feedback form — whatever the next batch will need to find."
              : 'Nobody has added a link to this project yet.'
          }
        />
      ) : (
        <ul className="space-y-3">
          {rows.map((resource) => {
            const editing = editingId === resource.id
            const confirming = confirmingDeleteId === resource.id
            const host = hostOf(resource.url)

            return (
              <li key={resource.id}>
                <Card className={cn(editing && 'border-gold-500/40')}>
                  {editing ? (
                    <>
                      <h2 className="font-display text-lg font-semibold text-brand-600">
                        Edit link
                      </h2>
                      <Ornament className="mt-2 mb-5" />
                      <ResourceForm
                        project={project.data}
                        resource={resource}
                        onDone={() => setEditingId(null)}
                      />
                    </>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        <ResourceKindBadge kind={resource.kind ?? 'OTHER'} />
                        <a
                          href={resource.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="group inline-flex min-w-0 items-center gap-1.5 font-display text-lg font-semibold text-ink hover:text-brand-600"
                        >
                          <span className="break-words">{resource.title}</span>
                          <ExternalLink
                            className="size-3.5 shrink-0 text-ink-mute group-hover:text-brand-600"
                            aria-hidden
                          />
                        </a>

                        {!confirming &&
                          canChangeResource(resource, role, isExec, user?.id) && (
                            <div className="ml-auto flex gap-1">
                              <Button variant="ghost" onClick={() => startEditing(resource)}>
                                <Pencil className="size-4" aria-hidden />
                                Edit
                              </Button>
                              <Button
                                variant="ghost"
                                aria-label={`Remove “${resource.title}” from the resources`}
                                onClick={() => setConfirmingDeleteId(resource.id)}
                              >
                                <Trash2 className="size-4" aria-hidden />
                                Remove
                              </Button>
                            </div>
                          )}

                        {confirming && (
                          <div className="ml-auto flex items-center gap-2">
                            {/* Says what is and is not destroyed: the row goes
                                for good — resources are not soft-deleted — but
                                whatever it points at is untouched in Drive. */}
                            <span className="text-xs text-ink-soft">
                              Remove the link? The file itself stays in Drive.
                            </span>
                            <Button
                              variant="danger"
                              disabled={deleteResource.isPending}
                              onClick={() =>
                                deleteResource.mutate(resource.id, {
                                  onSuccess: () => setConfirmingDeleteId(null),
                                })
                              }
                            >
                              {deleteResource.isPending ? 'Removing…' : 'Remove'}
                            </Button>
                            <Button
                              variant="secondary"
                              disabled={deleteResource.isPending}
                              onClick={() => setConfirmingDeleteId(null)}
                            >
                              Cancel
                            </Button>
                          </div>
                        )}
                      </div>

                      {confirming && deleteResource.error && (
                        <div className="mt-3">
                          <ErrorNote
                            message={
                              deleteResource.error instanceof ApiError
                                ? deleteResource.error.detail
                                : deleteResource.error.message
                            }
                          />
                        </div>
                      )}

                      {resource.description && (
                        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                          {resource.description}
                        </p>
                      )}

                      <p className="mt-3 text-xs text-ink-mute">
                        {host && <span className="break-all">{host}</span>}
                        {host && ' · '}
                        Added by {resource.added_by.full_name || resource.added_by.email}
                      </p>
                    </>
                  )}
                </Card>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
