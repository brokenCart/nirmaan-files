import { describe, expect, it } from 'vitest'

import { ALL_TERMS, isArchivedTerm } from '@/features/semesters/terms'
import { makeSemester } from '@/test/factories'

describe('isArchivedTerm', () => {
  const current = makeSemester({ slug: 'open' })

  it('treats no selection as the open term', () =>
    expect(isArchivedTerm(undefined, current)).toBe(false))

  it('does not treat the all-terms view as archived', () =>
    expect(isArchivedTerm(ALL_TERMS, current)).toBe(false))

  it('recognises the open term by slug', () => expect(isArchivedTerm('open', current)).toBe(false))
  it('marks any other term archived', () => expect(isArchivedTerm('old', current)).toBe(true))
})
