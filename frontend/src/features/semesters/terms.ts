import type { Semester } from '@/api/types'

/** The switcher's value for "every term at once". */
export const ALL_TERMS = 'all'

/**
 * Whether the viewed term is a closed one.
 *
 * Drives the read-only treatment on the timeline. A missing selection means
 * the open term, which the API also treats as the default — so absence is not
 * the same as "unknown" here.
 */
export function isArchivedTerm(
  selected: string | undefined,
  current: Semester | null | undefined,
): boolean {
  if (!selected || selected === ALL_TERMS) return false
  return selected !== current?.slug
}
