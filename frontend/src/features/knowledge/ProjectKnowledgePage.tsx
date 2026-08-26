import { BookOpen, Plus, Search } from 'lucide-react'
import { useDeferredValue, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import type { ArticleCategory } from '@/api/types'
import { ARTICLE_CATEGORIES, ARTICLE_CATEGORY_LABELS, canAddArticle } from '@/api/types'
import { useAuth } from '@/auth/AuthContext'
import { Ornament } from '@/components/Logo'
import { Button, Card, EmptyState, ErrorNote, Input, Spinner } from '@/components/ui'
import { useArticles, useProject } from '@/features/projects/queries'
import { cn, formatDateTime } from '@/lib/utils'

import { ArticleCategoryBadge } from './ArticleCategoryBadge'
import { ArticleForm } from './ArticleForm'

type CategoryFilter = 'ALL' | ArticleCategory

/** The searchable, cross-semester index of a project's shared knowledge. */
export function ProjectKnowledgePage() {
  const { slug = '' } = useParams()
  const navigate = useNavigate()
  const { roleIn } = useAuth()
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<CategoryFilter>('ALL')
  const [adding, setAdding] = useState(false)
  const deferredSearch = useDeferredValue(search.trim())

  const project = useProject(slug)
  const articles = useArticles(slug, {
    q: deferredSearch || undefined,
    category: category === 'ALL' ? undefined : category,
  })
  const role = roleIn(slug)
  const canAdd = canAddArticle(role)

  if (project.isPending) return <Spinner label="Loading project…" />
  if (project.error) return <ErrorNote message={project.error.message} />
  if (!project.data) return <ErrorNote message="Project not found." />

  const rows = articles.data ?? []
  const filtering = Boolean(search.trim()) || category !== 'ALL'

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to={`/projects/${slug}`} className="text-sm text-ink-mute hover:text-brand-600">
            ← {project.data.name} timeline
          </Link>
          <h1 className="mt-1 flex items-center gap-3 font-display text-2xl font-semibold text-ink">
            <BookOpen className="size-6 text-brand-600" aria-hidden />
            Knowledge base
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-soft">
            The context, practical details and lessons the next batch should not have to
            rediscover.
          </p>
        </div>

        {!adding && canAdd && (
          <Button onClick={() => setAdding(true)}>
            <Plus className="size-4" aria-hidden />
            New page
          </Button>
        )}
      </div>

      {!role && (
        <Card className="border-line-strong bg-paper-deep/40">
          <p className="text-sm text-ink-soft">
            You are not on this project&rsquo;s roster this semester. You can read its pages and
            history, but writing is for current members.
          </p>
        </Card>
      )}

      {adding && (
        <Card className="border-gold-500/40">
          <h2 className="font-display text-lg font-semibold text-brand-600">New knowledge page</h2>
          <Ornament className="mt-2 mb-5" />
          <ArticleForm
            project={project.data}
            onDone={(id) => {
              setAdding(false)
              navigate(`/projects/${slug}/knowledge/${id}`)
            }}
            onCancel={() => setAdding(false)}
          />
        </Card>
      )}

      <div className="space-y-3">
        <label className="relative block">
          <span className="sr-only">Search knowledge pages</span>
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-mute"
            aria-hidden
          />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="pl-9"
            placeholder="Search titles and page contents…"
          />
        </label>

        <div
          className="flex gap-1 overflow-x-auto rounded-xl border border-line bg-surface p-1"
          role="group"
          aria-label="Filter by topic"
        >
          {(['ALL', ...ARTICLE_CATEGORIES] as const).map((option) => (
            <Button
              key={option}
              variant={category === option ? 'primary' : 'ghost'}
              className="shrink-0 px-3"
              onClick={() => setCategory(option)}
            >
              {option === 'ALL' ? 'All topics' : ARTICLE_CATEGORY_LABELS[option]}
            </Button>
          ))}
        </div>
      </div>

      {articles.isPending ? (
        <Spinner label="Loading knowledge…" />
      ) : articles.error ? (
        <ErrorNote message={articles.error.message} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={filtering ? 'No pages match' : 'No knowledge pages yet'}
          description={
            filtering
              ? 'Try another search or topic.'
              : canAdd
                ? 'Write down the first thing the next batch should know.'
                : 'Nobody has written a page for this project yet.'
          }
        />
      ) : (
        <ul className={cn('grid gap-4 sm:grid-cols-2', articles.isPlaceholderData && 'opacity-60')}>
          {rows.map((article) => (
            <li key={article.id}>
              <Link
                to={`/projects/${slug}/knowledge/${article.id}`}
                className="block h-full rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
              >
                <Card className="group h-full transition-shadow hover:shadow-[0_1px_2px_rgba(47,29,22,0.06),0_16px_32px_-18px_rgba(47,29,22,0.45)]">
                  <ArticleCategoryBadge category={article.category} />
                  <h2 className="mt-3 font-display text-lg font-semibold text-ink group-hover:text-brand-600">
                    {article.title}
                  </h2>
                  <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-ink-soft">
                    {article.excerpt}
                  </p>
                  <p className="mt-4 border-t border-line pt-3 text-xs text-ink-mute">
                    Updated {formatDateTime(article.updated_at)} by{' '}
                    {article.updated_by.full_name || article.updated_by.email}
                    {article.revision_count > 1 && (
                      <> · {article.revision_count} versions</>
                    )}
                  </p>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
