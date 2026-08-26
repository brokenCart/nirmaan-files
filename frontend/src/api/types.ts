/**
 * Convenience aliases over the generated schema.
 *
 * Everything here derives from `schema.ts`, which is regenerated from the
 * backend's OpenAPI document by `npm run gen:api`. Renaming a serializer field
 * therefore breaks the build rather than the running app.
 */
import type { components } from './schema'

export type User = components['schemas']['User']
export type Project = components['schemas']['Project']
export type Membership = components['schemas']['Membership']
export type DailyLog = components['schemas']['DailyLog']
/** One academic term. Counting and rosters restart at each one. */
export type Semester = components['schemas']['Semester']
/** One semester's line in a project's archive. */
export type ArchiveTerm = components['schemas']['ArchiveTerm']
/** Body accepted by `POST /api/logs/` — includes the write-only `attendee_ids`. */
export type DailyLogInput = components['schemas']['DailyLogRequest']
/** Body accepted by `PATCH /api/logs/{id}/`. */
export type DailyLogPatch = components['schemas']['PatchedDailyLogRequest']
/** One member's visit/meeting counts on a project. */
export type AttendanceRow = components['schemas']['AttendanceRow']
export type Role = components['schemas']['RoleEnum']
export type LogKind = components['schemas']['KindEnum']
export type LogStatus = components['schemas']['StatusEnum']

/** A project role, or the org-wide committee marker the API returns. */
export type EffectiveRole = Role | 'EXEC'

export interface MembershipSummary {
  project_id: number
  project_slug: string
  project_name: string
  role: Role
}

export interface Session {
  access: string
  user: User
  memberships: MembershipSummary[]
}

export interface Paginated<T> {
  count: number
  next: string | null
  previous: string | null
  results: T[]
}

export const ROLE_LABELS: Record<EffectiveRole, string> = {
  EXEC: 'Executive Committee',
  LEAD: 'Project Lead',
  FINANCE_LEAD: 'Finance Lead',
  VOLUNTEER: 'Volunteer',
}

/** Roles permitted to edit any content within a project. */
export function isProjectStaff(role: EffectiveRole | null | undefined): boolean {
  return role === 'EXEC' || role === 'LEAD' || role === 'FINANCE_LEAD'
}

/**
 * Whether `log` sits in the term that is currently open.
 *
 * A closed semester is frozen: the entries in it are the project's record and
 * nobody edits them, author included. `currentSemester` being undefined (still
 * loading, or none exists) is treated as closed, so the UI never offers a
 * button that the server is about to refuse.
 */
export function isInOpenTerm(log: DailyLog, currentSemester: Semester | null | undefined): boolean {
  return currentSemester != null && log.semester === currentSemester.id
}

/**
 * Whether `user` may edit `log`, mirroring `DailyLogViewSet._assert_can_edit`.
 *
 * Authorship is the whole rule while the term is open: an entry is one
 * person's account of what happened, so no role — lead, finance lead or exec —
 * may reword it. Staff who disagree with an entry delete it instead (see
 * {@link canDeleteLog}). Once the term closes, nobody edits it at all.
 *
 * These predicates only decide whether to offer the button; the server is the
 * real gate, so a stale answer surfaces as a 403 on save rather than as a leak.
 */
export function canEditLog(
  log: DailyLog,
  userId: number | undefined,
  currentSemester: Semester | null | undefined,
): boolean {
  if (!isInOpenTerm(log, currentSemester)) return false
  return userId !== undefined && log.author.id === userId
}

/**
 * Whether `user` may soft-delete `log`, mirroring `_assert_can_delete`.
 *
 * Staff moderate the timeline; an author may also withdraw their own entry.
 * Exec keeps the lever over closed terms — something that should never have
 * been published stays removable a year on — but everyone else stops at the
 * term boundary.
 */
export function canDeleteLog(
  log: DailyLog,
  role: EffectiveRole | null | undefined,
  userId: number | undefined,
  currentSemester: Semester | null | undefined,
): boolean {
  if (!role) return false
  if (!isInOpenTerm(log, currentSemester)) return role === 'EXEC'
  return isProjectStaff(role) || log.author.id === userId
}
