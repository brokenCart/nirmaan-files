import { ChevronDown, ChevronUp, History, Pencil, RotateCcw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { ApiError } from '@/api/client'
import type { ArticleRevision } from '@/api/types'
import { canDeleteArticle, canEditArticle } from '@/api/types'
import { useAuth } from '@/auth/AuthContext'
import { Ornament } from '@/components/Logo'
import { Button, Card, ErrorNote, Spinner } from '@/components/ui'
import {
  useArticle,
  useArticleRevisions,
  useDeleteArticle,
  useProject,
} from '@/features/projects/queries'
import { formatDateTime } from '@/lib/utils'

import { ArticleCategoryBadge } from './ArticleCategoryBadge'
import { ArticleForm } from './ArticleForm'
import { MarkdownBody } from './MarkdownBody'

function RevisionRow({
  revision,
  selected,
  onPreview,
  onRestore,
  canRestore,
}: {
  revision: ArticleRevision
  selected: boolean
  onPreview: () => void
  onRestore: () => void
  canRestore: boolean
}) {
  return (
    <li className="border-b border-line py-3 last:border-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <button type="button" className="min-w-0 text-left" onClick={onPreview}>
          <span className="block text-sm font-medium text-ink">
            {revision.edited_by.full_name || revision.edited_by.email}
          </span>
          <span className="block text-xs text-ink-mute">
            {formatDateTime(revision.created_at)}
            {revision.note && <> · {revision.note}</>}
          </span>
        </button>
        <div className="flex gap-1">
          <Button variant="ghost" className="px-3 py-1.5" onClick={onPreview}>
            {selected ? 'Viewing' : 'Preview'}
          </Button>
          {canRestore && (
            <Button variant="ghost" className="px-3 py-1.5" onClick={onRestore}>
              <RotateCcw className="size-3.5" aria-hidden />
              Restore
            </Button>
          )}
        </div>
      </div>
    </li>
  )
}

/** A knowledge page, its collaborative editor, and its complete revision trail. */
export function ArticlePage() {
  const { slug = '', articleId = '' } = useParams()
  const navigate = useNavigate()
  const { roleIn, user } = useAuth()
  const id = Number(articleId)
  const [editing, setEditing] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [preview, setPreview] = useState<ArticleRevision | null>(null)
  const [restoreBody, setRestoreBody] = useState<string | undefined>()
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const project = useProject(slug)
  const article = useArticle(id)
  const revisions = useArticleRevisions(id, historyOpen)
  const deleteArticle = useDeleteArticle(slug)
  const role = roleIn(slug)

  if (!Number.isInteger(id) || id <= 0) return <ErrorNote message="Page not found." />
  if (project.isPending || article.isPending) return <Spinner label="Loading page…" />
  if (project.error) return <ErrorNote message={project.error.message} />
  if (article.error) return <ErrorNote message={article.error.message} />
  if (!project.data || !article.data || article.data.project_slug !== slug) {
    return <ErrorNote message="Page not found." />
  }

  const page = article.data
  const canEdit = canEditArticle(role)
  const canDelete = canDeleteArticle(page, role, user?.is_exec ?? false, user?.id)

  function startRestore(revision: ArticleRevision) {
    setPreview(null)
    setRestoreBody(revision.body)
    setEditing(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          to={`/projects/${slug}/knowledge`}
          className="text-sm text-ink-mute hover:text-brand-600"
        >
          ← {project.data.name} knowledge base
        </Link>
      </div>

      {editing ? (
        <Card className="border-gold-500/40">
          <h1 className="font-display text-xl font-semibold text-brand-600">
            {restoreBody === undefined ? 'Edit page' : 'Restore an older version'}
          </h1>
          <p className="mt-1 text-sm text-ink-soft">
            {restoreBody === undefined
              ? 'Every saved change remains visible in the page history.'
              : 'Saving creates a new version; it does not erase the changes made since.'}
          </p>
          <Ornament className="mt-2 mb-5" />
          <ArticleForm
            key={restoreBody ?? 'edit'}
            project={project.data}
            article={page}
            initialBody={restoreBody}
            onDone={() => {
              setEditing(false)
              setRestoreBody(undefined)
            }}
            onCancel={() => {
              setEditing(false)
              setRestoreBody(undefined)
            }}
          />
        </Card>
      ) : (
        <article>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <ArticleCategoryBadge category={page.category ?? 'OTHER'} />
              <h1 className="mt-3 font-display text-3xl font-semibold text-ink">{page.title}</h1>
              <p className="mt-2 text-xs text-ink-mute">
                Updated {formatDateTime(page.updated_at)} by{' '}
                {page.updated_by.full_name || page.updated_by.email}
              </p>
            </div>

            {!confirmingDelete && (
              <div className="flex flex-wrap gap-1">
                {canEdit && (
                  <Button variant="secondary" onClick={() => setEditing(true)}>
                    <Pencil className="size-4" aria-hidden />
                    Edit
                  </Button>
                )}
                {canDelete && (
                  <Button variant="ghost" onClick={() => setConfirmingDelete(true)}>
                    <Trash2 className="size-4" aria-hidden />
                    Remove
                  </Button>
                )}
              </div>
            )}

            {confirmingDelete && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-ink-soft">Remove this page from the knowledge base?</span>
                <Button
                  variant="danger"
                  disabled={deleteArticle.isPending}
                  onClick={() =>
                    deleteArticle.mutate(page.id, {
                      onSuccess: () => navigate(`/projects/${slug}/knowledge`, { replace: true }),
                    })
                  }
                >
                  {deleteArticle.isPending ? 'Removing…' : 'Remove'}
                </Button>
                <Button
                  variant="secondary"
                  disabled={deleteArticle.isPending}
                  onClick={() => setConfirmingDelete(false)}
                >
                  Cancel
                </Button>
              </div>
            )}
          </div>

          {deleteArticle.error && (
            <div className="mt-4">
              <ErrorNote
                message={
                  deleteArticle.error instanceof ApiError
                    ? deleteArticle.error.detail
                    : deleteArticle.error.message
                }
              />
            </div>
          )}

          <Card className="mt-6 px-6 py-7 sm:px-8">
            <MarkdownBody body={page.body} />
          </Card>

          <p className="mt-3 text-xs text-ink-mute">
            Started {formatDateTime(page.created_at)} by{' '}
            {page.created_by.full_name || page.created_by.email}
          </p>
        </article>
      )}

      <Card>
        <button
          type="button"
          className="flex w-full items-center gap-2 text-left"
          aria-expanded={historyOpen}
          onClick={() => {
            setHistoryOpen((open) => !open)
            setPreview(null)
          }}
        >
          <History className="size-5 text-brand-600" aria-hidden />
          <span className="font-display text-lg font-semibold text-ink">Page history</span>
          <span className="text-xs text-ink-mute">
            {page.revision_count} {page.revision_count === 1 ? 'version' : 'versions'}
          </span>
          {historyOpen ? (
            <ChevronUp className="ml-auto size-4 text-ink-mute" aria-hidden />
          ) : (
            <ChevronDown className="ml-auto size-4 text-ink-mute" aria-hidden />
          )}
        </button>

        {historyOpen && (
          <div className="mt-4 border-t border-line pt-2">
            {revisions.isPending ? (
              <Spinner label="Loading history…" />
            ) : revisions.error ? (
              <ErrorNote message={revisions.error.message} />
            ) : (
              <>
                <ol>
                  {revisions.data?.map((revision, index) => (
                    <RevisionRow
                      key={revision.id}
                      revision={revision}
                      selected={preview?.id === revision.id}
                      onPreview={() => setPreview(preview?.id === revision.id ? null : revision)}
                      onRestore={() => startRestore(revision)}
                      canRestore={canEdit && index !== 0}
                    />
                  ))}
                </ol>

                {preview && (
                  <div className="mt-5 rounded-xl border border-line bg-paper/50 p-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <ArticleCategoryBadge category={preview.category} />
                      <h2 className="font-display text-lg font-semibold text-ink">
                        {preview.title}
                      </h2>
                    </div>
                    <MarkdownBody body={preview.body} className="mt-4" />
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </Card>
    </div>
  )
}
