import { Plus, Search } from 'lucide-react'
import { useDeferredValue, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import type { ArticleCategory } from '@/api/types'
import { ARTICLE_CATEGORIES, ARTICLE_CATEGORY_LABELS, canAddArticle } from '@/api/types'
import { useAuth } from '@/auth/AuthContext'
import { ProjectHeader } from '@/components/ProjectHeader'
import {
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Input,
  Notice,
  SectionIntro,
  Segmented,
  Spinner,
} from '@/components/ui'
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
    <div>
      <ProjectHeader project={project.data} />

      <div className="space-y-6">
        <SectionIntro
          title="Knowledge base"
          description="How this project works: background, routines, contacts and lessons."
          actions={
            !adding &&
            canAdd && (
              <Button onClick={() => setAdding(true)}>
                <Plus className="size-4" aria-hidden />
                New page
              </Button>
            )
          }
        />

        {!role && (
          <Notice>
            You&rsquo;re not a member this semester, so you can read pages but not edit them.
          </Notice>
        )}

        {adding && (
          <Card className="border-brand-200">
            <h3 className="mb-5 text-xl font-semibold text-ink">New knowledge page</h3>
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
          <label className="relative block max-w-xl">
            <span className="sr-only">Search knowledge pages</span>
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-mute"
              aria-hidden
            />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="pl-9"
              placeholder="Search pages"
            />
          </label>

          <Segmented
            options={['ALL', ...ARTICLE_CATEGORIES] as const}
            value={category}
            onChange={setCategory}
            label="Filter by topic"
            renderLabel={(option) =>
              option === 'ALL' ? 'All topics' : ARTICLE_CATEGORY_LABELS[option]
            }
          />
        </div>

        {articles.isPending ? (
          <Spinner label="Loading knowledge…" />
        ) : articles.error ? (
          <ErrorNote message={articles.error.message} />
        ) : rows.length === 0 ? (
          <EmptyState
            title={filtering ? 'No pages match' : 'No pages yet'}
            description={
              filtering
                ? 'Try a different search or topic.'
                : canAdd
                  ? 'Write the first page for this project.'
                  : 'No one has written a page yet.'
            }
          />
        ) : (
          // One sheet ruled into cells: the 1px gap shows the `line` behind.
          // A lone last cell spans both columns rather than leaving a hole.
          <ul
            className={cn(
              'grid gap-px overflow-hidden rounded-[10px] border border-line bg-line sm:grid-cols-2 sm:[&>li:last-child:nth-child(odd)]:col-span-2',
              articles.isPlaceholderData && 'opacity-60',
            )}
          >
            {rows.map((article, index) => (
              <li
                key={article.id}
                // Alternate by row on a phone, as a checkerboard on two columns,
                // so neighbouring pages never share a colour either way.
                className={cn(
                  index % 2 === 1 ? 'bg-stripe' : 'bg-surface',
                  index % 4 === 1 || index % 4 === 2 ? 'sm:bg-stripe' : 'sm:bg-surface',
                )}
              >
                <Link
                  to={`/projects/${slug}/knowledge/${article.id}`}
                  className="group flex h-full flex-col p-5 transition-colors hover:bg-brand-100 focus-visible:outline-offset-[-2px] sm:p-6"
                >
                  <ArticleCategoryBadge category={article.category} className="self-start" />
                  <h3 className="mt-3 text-2xl font-semibold text-ink group-hover:text-brand-700">
                    {article.title}
                  </h3>
                  <p className="mt-2 line-clamp-3 max-w-[60ch] text-sm leading-relaxed text-ink-soft">
                    {article.excerpt}
                  </p>
                  <p className="mt-auto pt-4 text-sm text-ink-mute">
                    Updated {formatDateTime(article.updated_at)} by{' '}
                    {article.updated_by.full_name || article.updated_by.email}
                    {article.revision_count > 1 && <>, {article.revision_count} versions</>}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
