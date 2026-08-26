import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '@/api/client'
import type {
  ArchiveTerm,
  AttendanceRow,
  DailyLog,
  DailyLogInput,
  DailyLogPatch,
  Membership,
  MembershipInput,
  Paginated,
  Project,
  Semester,
} from '@/api/types'

export const queryKeys = {
  projects: ['projects'] as const,
  project: (slug: string) => ['projects', slug] as const,
  logs: (filters: LogFilters) => ['logs', filters] as const,
  semesters: ['semesters'] as const,
  currentSemester: ['semesters', 'current'] as const,
  archive: (slug: string) => ['archive', slug] as const,
  // Rosters and counts are per term, so the term is part of the cache key —
  // switching semesters must not read the previous one's rows from cache.
  members: (slug: string, semester?: string) => ['memberships', slug, semester ?? null] as const,
  /** Prefix matching every term's roster for one project — see {@link attendanceForProject}. */
  membersForProject: (slug: string) => ['memberships', slug] as const,
  attendance: (slug: string, semester?: string) =>
    ['attendance', slug, semester ?? null] as const,
  /**
   * Prefix matching every term's counts for one project.
   *
   * Invalidation must use this rather than `attendance(slug)`: that builds a
   * fully-specified key ending in `null`, which would clear only the
   * default-term query and leave a viewed past term showing stale numbers.
   */
  attendanceForProject: (slug: string) => ['attendance', slug] as const,
}

/**
 * Rows per page of `/api/logs/`.
 *
 * DRF's PageNumberPagination reports `count` but not the page size, and the
 * SPA needs the size to turn a count into a page total. This must therefore
 * track `DailyLogPagination.page_size` in `apps/logs/pagination.py` — the
 * timeline pages smaller than the project-wide `REST_FRAMEWORK["PAGE_SIZE"]`.
 */
export const LOGS_PAGE_SIZE = 10

/** Index signature included so filters can be passed straight as query params. */
export type LogFilters = {
  project?: string
  kind?: string
  since?: string
  until?: string
  /** A semester slug, or `all` to read across every term. Defaults to the open one. */
  semester?: string
  page?: number
} & Record<string, string | number | undefined>

export function useProjects() {
  return useQuery({
    queryKey: queryKeys.projects,
    queryFn: () => api.get<Paginated<Project>>('/api/projects/'),
  })
}

export function useProject(slug: string) {
  return useQuery({
    queryKey: queryKeys.project(slug),
    queryFn: () => api.get<Project>(`/api/projects/${slug}/`),
  })
}

export function useLogs(filters: LogFilters) {
  return useQuery({
    queryKey: queryKeys.logs(filters),
    queryFn: () => api.get<Paginated<DailyLog>>('/api/logs/', filters),
    // Hold the previous page on screen while the next one loads, so paging
    // does not collapse the feed to a spinner and jump the scroll position.
    placeholderData: keepPreviousData,
  })
}

export function useProjectMembers(slug: string, semester?: string) {
  return useQuery({
    queryKey: queryKeys.members(slug, semester),
    queryFn: () =>
      api.get<Paginated<Membership>>('/api/memberships/', { project: slug, semester }),
  })
}

/**
 * Per-member visit and meeting counts for one term.
 *
 * Not paginated — a project roster is tens of people, and both the chart and
 * the export need the whole set at once.
 */
export function useAttendance(slug: string, semester?: string) {
  return useQuery({
    queryKey: queryKeys.attendance(slug, semester),
    queryFn: () =>
      api.get<AttendanceRow[]>(`/api/projects/${slug}/attendance/`, { semester }),
  })
}

/** Every term, newest first. Drives the term switcher. */
export function useSemesters() {
  return useQuery({
    queryKey: queryKeys.semesters,
    queryFn: () => api.get<Paginated<Semester>>('/api/semesters/'),
    // Terms change twice a year; refetching them on every mount is waste.
    staleTime: 5 * 60 * 1000,
  })
}

/**
 * The term in progress.
 *
 * Read by the write-affordance predicates in `api/types.ts`, so it is fetched
 * from the server rather than inferred from today's date on the client — the
 * two can disagree across a timezone, and the server's answer is the one that
 * decides whether a save succeeds.
 */
export function useCurrentSemester() {
  return useQuery({
    queryKey: queryKeys.currentSemester,
    queryFn: () => api.get<Semester | null>('/api/semesters/current/'),
    staleTime: 5 * 60 * 1000,
  })
}

/** One row per term this project has a record in, newest first. */
export function useProjectArchive(slug: string) {
  return useQuery({
    queryKey: queryKeys.archive(slug),
    queryFn: () => api.get<ArchiveTerm[]>(`/api/projects/${slug}/archive/`),
  })
}

/**
 * Adds one person to a project's roster for one term.
 *
 * The body identifies them by email rather than id, so a lead can add someone
 * who has never signed in — the placeholder user is adopted on their first
 * Google login. `semester` is always sent explicitly rather than left to the
 * serializer's current-term default, because exec correcting a past roster is
 * a supported case and the default would silently retarget it.
 */
export function useAddMember(projectSlug: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: MembershipInput) => api.post<Membership>('/api/memberships/', body),
    onSuccess: () => {
      // Every term's roster, not just the viewed one: the `all` view holds the
      // new row too, and its key is a different one.
      void queryClient.invalidateQueries({ queryKey: queryKeys.membersForProject(projectSlug) })
      // A new member is a new row in the attendance table, at zero.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.attendanceForProject(projectSlug),
      })
      // The archive reports roster size per term.
      void queryClient.invalidateQueries({ queryKey: queryKeys.archive(projectSlug) })
    },
  })
}

export function useCreateLog(projectSlug: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: DailyLogInput) => api.post<DailyLog>('/api/logs/', body),
    onSuccess: () => {
      // The timeline is filtered several ways; invalidate the whole namespace
      // rather than guessing which cached filter combinations went stale.
      void queryClient.invalidateQueries({ queryKey: ['logs'] })
      void queryClient.invalidateQueries({ queryKey: queryKeys.project(projectSlug) })
      // Attendees on a new entry move the counts.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.attendanceForProject(projectSlug),
      })
      // And the archive's per-term totals.
      void queryClient.invalidateQueries({ queryKey: queryKeys.archive(projectSlug) })
    },
  })
}

export function useUpdateLog(projectSlug: string) {
  const queryClient = useQueryClient()
  return useMutation({
    // PATCH rather than PUT: the form carries only the editable fields, and
    // the server owns `author` and the timestamps.
    mutationFn: ({ id, ...body }: DailyLogPatch & { id: number }) =>
      api.patch<DailyLog>(`/api/logs/${id}/`, body),
    onSuccess: () => {
      // An edit can change `occurred_on` or `status`, which reorders the feed
      // and moves rows between drafts and the public timeline.
      void queryClient.invalidateQueries({ queryKey: ['logs'] })
      void queryClient.invalidateQueries({ queryKey: queryKeys.project(projectSlug) })
      // Editing attendees, kind or status all change what the counts include.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.attendanceForProject(projectSlug),
      })
      // Moving `occurred_on` can move the entry between terms, which changes
      // two rows of the archive at once.
      void queryClient.invalidateQueries({ queryKey: queryKeys.archive(projectSlug) })
    },
  })
}

export function useDeleteLog() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<void>(`/api/logs/${id}/`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['logs'] })
      // A removed entry stops counting; the hook has no slug, so clear them all.
      void queryClient.invalidateQueries({ queryKey: ['attendance'] })
      void queryClient.invalidateQueries({ queryKey: ['archive'] })
    },
  })
}
