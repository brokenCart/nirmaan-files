import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { RESOURCE_KIND_LABELS, RESOURCE_KINDS } from '@/api/types'
import { ResourceKindBadge } from '@/features/resources/ResourceKindBadge'

describe('ResourceKindBadge', () => {
  it.each(RESOURCE_KINDS)('labels %s', (kind) => {
    render(<ResourceKindBadge kind={kind} />)
    expect(screen.getByText(RESOURCE_KIND_LABELS[kind])).toBeInTheDocument()
  })
})
