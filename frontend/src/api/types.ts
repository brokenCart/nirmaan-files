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
