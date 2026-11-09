import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ARTICLE_CATEGORIES, ARTICLE_CATEGORY_LABELS } from '@/api/types'
import { ArticleCategoryBadge } from '@/features/knowledge/ArticleCategoryBadge'

describe('ArticleCategoryBadge', () => {
  it.each(ARTICLE_CATEGORIES)('labels %s', (category) => {
    render(<ArticleCategoryBadge category={category} />)
    expect(screen.getByText(ARTICLE_CATEGORY_LABELS[category])).toBeInTheDocument()
  })
})
