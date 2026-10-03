import { BookOpen, FileText, Lightbulb, ListChecks, Users } from 'lucide-react'
import type { ComponentType, SVGProps } from 'react'

import type { ArticleCategory } from '@/api/types'
import { ARTICLE_CATEGORY_LABELS } from '@/api/types'
import { cn } from '@/lib/utils'

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>

/**
 * The icon and colour each category wears.
 *
 * Local to this feature for the reason `ResourceKindBadge` is local to its
 * own: it is read on two screens, not app-wide. Colours come from the same
 * logo palette, so the knowledge base reads as part of the app rather than as
 * a second scheme.
 */
const CATEGORY_STYLES: Record<ArticleCategory, { icon: IconComponent; className: string }> = {
  CONTEXT: { icon: BookOpen, className: 'bg-gold-50 text-gold-600 ring-gold-100' },
  PROCESS: {
    icon: ListChecks,
    className: 'bg-brand-50 text-brand-700 ring-brand-200',
  },
  PARTNER: {
    icon: Users,
    className: 'bg-nirmaan-green/10 text-nirmaan-green-ink ring-nirmaan-green/20',
  },
  LESSON: { icon: Lightbulb, className: 'bg-paper-deep text-ink-soft ring-line-strong' },
  OTHER: { icon: FileText, className: 'bg-surface text-ink-mute ring-line-strong' },
}

export function ArticleCategoryBadge({
  category,
  className,
}: {
  category: ArticleCategory
  className?: string
}) {
  const { icon: Icon, className: styles } = CATEGORY_STYLES[category]
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded px-2 py-0.5 text-sm font-medium whitespace-nowrap ring-1 ring-inset',
        styles,
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {ARTICLE_CATEGORY_LABELS[category]}
    </span>
  )
}
