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
/** Body accepted by `POST /api/memberships/` — identifies the person by email. */
export type MembershipInput = components['schemas']['MembershipRequest']
/** One member's visit/meeting counts on a project. */
export type AttendanceRow = components['schemas']['AttendanceRow']
export type Role = components['schemas']['RoleEnum']
export type LogKind = components['schemas']['DailyLogKindEnum']
export type LogStatus = components['schemas']['StatusEnum']

/** A named link on a project's shelf — a Drive folder, a report, a form. */
export type Resource = components['schemas']['Resource']
/** Body accepted by `POST /api/resources/`. */
export type ResourceInput = components['schemas']['ResourceRequest']
/** Body accepted by `PATCH /api/resources/{id}/`. */
export type ResourcePatch = components['schemas']['PatchedResourceRequest']
export type ResourceKind = components['schemas']['ResourceKindEnum']

/** A page in a project's knowledge base, in full. */
export type Article = components['schemas']['Article']
/** A page as the index lists it: an excerpt in place of the body. */
export type ArticleListItem = components['schemas']['ArticleList']
/** One saved version of a page, with the text it held. */
export type ArticleRevision = components['schemas']['ArticleRevision']
/** Body accepted by `POST /api/articles/`. */
export type ArticleInput = components['schemas']['ArticleRequest']
/** Body accepted by `PATCH /api/articles/{id}/`. */
export type ArticlePatch = components['schemas']['PatchedArticleRequest']
export type ArticleCategory = components['schemas']['CategoryEnum']

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

/**
 * What sits at the other end of a resource link.
 *
 * Ordered as the picker offers them — the project's Drive folder first, since
 * it is the link most shelves start with.
 */
export const RESOURCE_KINDS: ResourceKind[] = ['FOLDER', 'DOCUMENT', 'SHEET', 'FORM', 'OTHER']

export const RESOURCE_KIND_LABELS: Record<ResourceKind, string> = {
  FOLDER: 'Drive folder',
  DOCUMENT: 'Document',
  SHEET: 'Spreadsheet',
  FORM: 'Form',
  OTHER: 'Link',
}

/**
 * The topics a knowledge page can be filed under.
 *
 * Ordered as the index stacks them, which is roughly the order a newcomer needs
 * them in: what this project is, how to do the work, who to talk to, and what
 * went wrong last time.
 */
export const ARTICLE_CATEGORIES: ArticleCategory[] = [
  'CONTEXT',
  'PROCESS',
  'PARTNER',
  'LESSON',
  'OTHER',
]

export const ARTICLE_CATEGORY_LABELS: Record<ArticleCategory, string> = {
  CONTEXT: 'Background',
  PROCESS: 'How we do it',
  PARTNER: 'People and partners',
  LESSON: 'Lessons learned',
  OTHER: 'Other',
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
 * Authorship plus a current-term role: an entry is one person's account of what
 * happened, so no role — lead, finance lead or exec — may reword it, and being
 * its author no longer helps once you are off the roster. A former member reads
 * the timeline with no Edit button on it. Staff who disagree with an entry
 * delete it instead (see {@link canDeleteLog}); once the term closes, nobody
 * edits it at all.
 *
 * These predicates only decide whether to offer the button; the server is the
 * real gate, so a stale answer surfaces as a 403 on save rather than as a leak.
 */
export function canEditLog(
  log: DailyLog,
  role: EffectiveRole | null | undefined,
  userId: number | undefined,
  currentSemester: Semester | null | undefined,
): boolean {
  if (!role) return false
  if (!isInOpenTerm(log, currentSemester)) return false
  return userId !== undefined && log.author.id === userId
}

/**
 * Roles the caller may hand out, mirroring
 * `MembershipViewSet.LEAD_ASSIGNABLE_ROLES`.
 *
 * A lead adds volunteers and nothing else. Lead and finance lead carry the
 * money and the roster itself, so a lead who could name them could appoint
 * their own successor — or a second lead — with nobody above them in the loop.
 * Exec appoints staff.
 *
 * Typed as non-empty so callers can read `[0]` as the default without a
 * fallback — there is always at least `VOLUNTEER` to hand out.
 */
export function assignableRoles(isExec: boolean): [Role, ...Role[]] {
  return isExec ? ['VOLUNTEER', 'FINANCE_LEAD', 'LEAD'] : ['VOLUNTEER']
}

/**
 * Whether the roster of `target` may be edited, mirroring
 * `MembershipViewSet._assert_can_manage`.
 *
 * A lead manages the open term only: last term's roster is the record of who
 * filed the entries sitting in the archive, so rewriting it would restate who
 * was there. Exec keeps the lever over closed terms, which matters because the
 * rows for terms predating semesters were backfilled from a guess.
 *
 * `isExec` is passed separately rather than read off `role`, because `roleIn`
 * reports a project membership in preference to the committee marker — an exec
 * who also volunteers here comes back `VOLUNTEER`, and the server would still
 * let them through on `is_exec`.
 *
 * A missing `target` is treated as unmanageable: no term resolved means no
 * answer to "added to which semester", and the server would have to guess too.
 */
export function canManageRoster(
  role: EffectiveRole | null | undefined,
  isExec: boolean,
  target: Semester | null | undefined,
  currentSemester: Semester | null | undefined,
): boolean {
  if (!target) return false
  if (isExec) return true
  if (role !== 'LEAD') return false
  return target.id === currentSemester?.id
}

/**
 * Whether `member` may be taken off the roster of `target`.
 *
 * Same authority as adding: `canManageRoster` decides the term, and a lead may
 * only touch the roles they could hand out — so a lead removes volunteers and
 * exec removes anyone. Mirrors the role check in `_assert_can_manage`, which
 * receives the row's current role on destroy for exactly this reason.
 *
 * Never your own row, whoever you are — mirrors `_assert_not_self`. Leaving is
 * someone else's action, which keeps the only lead from stranding a roster and
 * an exec from quietly dropping themselves mid-term.
 */
export function canRemoveMember(
  member: Membership,
  role: EffectiveRole | null | undefined,
  isExec: boolean,
  target: Semester | null | undefined,
  currentSemester: Semester | null | undefined,
  userId: number | undefined,
): boolean {
  if (!canManageRoster(role, isExec, target, currentSemester)) return false
  if (member.user.id === userId) return false
  if (isExec) return true
  return member.role !== undefined && assignableRoles(false).includes(member.role)
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

/**
 * Whether the caller may add a link to a project's shelf, mirroring
 * `ResourceViewSet.perform_create`.
 *
 * Any current member, which is the same bar as filing an entry. `role` is null
 * for someone here on a past membership — they read the shelf and add nothing.
 */
export function canAddResource(role: EffectiveRole | null | undefined): boolean {
  return Boolean(role)
}

/**
 * Whether the caller may edit or remove `resource`, mirroring
 * `ResourceViewSet._assert_can_change`.
 *
 * Whoever added it, or whoever runs the project. Deliberately wider than
 * {@link canEditLog}: an entry is one person's account of what happened and
 * nobody rewords it under their name, but a link is a pointer, and when a Drive
 * folder moves the lead has to be able to fix the URL without hunting down the
 * volunteer who first pasted it.
 *
 * `isExec` is passed separately rather than read off `role`, for the same
 * reason {@link canManageRoster} takes it separately: `roleIn` reports a
 * project membership in preference to the committee marker, so an exec who
 * also volunteers here comes back `VOLUNTEER` and would lose a control the
 * server would have granted.
 *
 * There is no term argument because a resource has no term — the shelf a
 * project had in August is the shelf it still has in January.
 */
export function canChangeResource(
  resource: Resource,
  role: EffectiveRole | null | undefined,
  isExec: boolean,
  userId: number | undefined,
): boolean {
  if (isExec) return true
  if (!role) return false
  if (isProjectStaff(role)) return true
  return userId !== undefined && resource.added_by.id === userId
}

/**
 * Whether the caller may start a page, mirroring
 * `ArticleViewSet.perform_create`.
 *
 * Any current member, the same bar as filing an entry or adding a link. `role`
 * is null for someone here on a past membership — they read the knowledge base
 * and write none of it.
 */
export function canAddArticle(role: EffectiveRole | null | undefined): boolean {
  return Boolean(role)
}

/**
 * Whether the caller may edit `article`, mirroring
 * `ArticleViewSet._assert_can_edit`.
 *
 * Any current member, and deliberately nothing else — no authorship test, which
 * makes this the widest write predicate in the app. It takes no article at all,
 * and that absence is the rule: who wrote a page has no bearing on who may fix
 * it. Compare {@link canEditLog}, which is the narrowest — an entry is one
 * person's account of what happened and nobody rewords it, while an article is
 * a shared statement of what is currently true and goes stale if only its
 * original author may touch it.
 *
 * What makes the width safe is the revision trail: every save keeps the version
 * it replaced, attributed, so an edit can be read and undone. Restoring is an
 * ordinary edit and so needs no predicate of its own.
 *
 * No `isExec` argument, unlike {@link canChangeResource}: exec is a superset of
 * "any current member" here, and `roleIn` returns `EXEC` for a committee member
 * with no membership on the project, so `Boolean(role)` already covers both.
 */
export function canEditArticle(role: EffectiveRole | null | undefined): boolean {
  return Boolean(role)
}

/**
 * Whether the caller may remove `article`, mirroring
 * `ArticleViewSet._assert_can_delete`.
 *
 * Narrow exactly where {@link canEditArticle} is wide. Editing is visible and
 * reversible; removing takes the page off the index, so it is moderation and
 * answers to the same set the timeline's does — staff, exec, or whoever started
 * it. The delete is soft, as on the timeline and unlike the shelf.
 *
 * `isExec` is passed separately for the reason {@link canChangeResource} takes
 * it separately: `roleIn` reports a project membership in preference to the
 * committee marker, so an exec who also volunteers here comes back `VOLUNTEER`
 * and would lose a control the server would have granted.
 */
export function canDeleteArticle(
  article: Pick<Article, 'created_by'>,
  role: EffectiveRole | null | undefined,
  isExec: boolean,
  userId: number | undefined,
): boolean {
  if (isExec) return true
  if (!role) return false
  if (isProjectStaff(role)) return true
  return userId !== undefined && article.created_by.id === userId
}
