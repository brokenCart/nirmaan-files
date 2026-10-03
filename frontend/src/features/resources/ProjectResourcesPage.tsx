import { ExternalLink, Pencil, Plus, Trash2 } from 'lucide-react'
import { useDeferredValue, useState } from 'react'
import { useParams } from 'react-router-dom'

import { ApiError } from '@/api/client'
import type { Resource } from '@/api/types'
import { RESOURCE_KIND_LABELS, canAddResource, canChangeResource } from '@/api/types'
import { useAuth } from '@/auth/AuthContext'
import { ProjectHeader } from '@/components/ProjectHeader'
import {
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Notice,
  SearchField,
  SectionIntro,
  Spinner,
} from '@/components/ui'
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
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search.trim().toLowerCase())
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

  const shelf = resources.data ?? []
  // Filtered here rather than on the server: the shelf arrives whole and
  // unpaginated, so a scan of the array beats a request per keystroke.
  const rows = deferredSearch
    ? shelf.filter((resource) =>
        [
          resource.title,
          resource.description,
          resource.url,
          RESOURCE_KIND_LABELS[resource.kind ?? 'OTHER'],
          resource.added_by.full_name,
          resource.added_by.email,
        ]
          .join(' ')
          .toLowerCase()
          .includes(deferredSearch),
      )
    : shelf

  return (
    <div>
      <ProjectHeader project={project.data} />

      <div className="space-y-6">
        <SectionIntro
          title="Resources"
          description={<>Links to this project&rsquo;s Drive folders, documents and forms.</>}
          actions={
            !adding &&
            canAdd && (
              <Button onClick={startAdding}>
                <Plus className="size-4" aria-hidden />
                Add link
              </Button>
            )
          }
        />

        {!role && (
          <Notice>
            You&rsquo;re not a member this semester, so you can open links but not add or edit them.
          </Notice>
        )}

        {adding && (
          <Card className="border-brand-200">
            <h3 className="mb-5 text-xl font-semibold text-ink">New link</h3>
            <ResourceForm project={project.data} onDone={() => setAdding(false)} />
          </Card>
        )}

        {shelf.length > 0 && (
          <SearchField
            value={search}
            onChange={setSearch}
            label="Search links"
            placeholder="Search links"
            className="w-full sm:w-72"
          />
        )}

        {resources.isPending ? (
          <Spinner label="Loading resources…" />
        ) : resources.error ? (
          <ErrorNote message={resources.error.message} />
        ) : rows.length === 0 && deferredSearch ? (
          <EmptyState title="No links match" description="Try a different search." />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No links yet"
            description={
              canAdd
                ? 'Add the project’s Drive folder, plans or forms.'
                : 'No one has added a link yet.'
            }
          />
        ) : (
          <ul className="overflow-hidden rounded-[10px] border border-line bg-surface">
            {rows.map((resource) => {
              const editing = editingId === resource.id
              const confirming = confirmingDeleteId === resource.id
              const host = hostOf(resource.url)

              return (
                <li
                  key={resource.id}
                  className={cn(
                    'border-b border-line p-5 last:border-0 even:bg-stripe',
                    editing && 'bg-gold-50 even:bg-gold-50',
                  )}
                >
                  {editing ? (
                    <>
                      <h3 className="mb-5 text-xl font-semibold text-ink">Edit link</h3>
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
                          className="group inline-flex min-w-0 items-center gap-1.5 font-display text-xl font-semibold text-ink hover:text-brand-600"
                        >
                          <span className="break-words">{resource.title}</span>
                          <ExternalLink
                            className="size-3.5 shrink-0 text-ink-mute group-hover:text-brand-600"
                            aria-hidden
                          />
                        </a>

                        {!confirming && canChangeResource(resource, role, isExec, user?.id) && (
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
                            <span className="text-sm text-ink-soft">
                              Remove this link? The file stays in Drive.
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

                      <p className="mt-2 text-sm text-ink-mute">
                        {host && <span className="break-all text-brand-700">{host}</span>}
                        {host && ', added by '}
                        {!host && 'Added by '}
                        {resource.added_by.full_name || resource.added_by.email}
                      </p>
                    </>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
