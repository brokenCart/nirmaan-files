import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '@/api/client'
import type {
  AttendanceRow,
  DailyLog,
  DailyLogInput,
  DailyLogPatch,
  Membership,
  Paginated,
  Project,
} from '@/api/types'

export const queryKeys = {
  projects: ['projects'] as const,
  project: (slug: string) => ['projects', slug] as const,
  logs: (filters: LogFilters) => ['logs', filters] as const,
  members: (slug: string) => ['memberships', slug] as const,
  attendance: (slug: string) => ['attendance', slug] as const,
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

export function useProjectMembers(slug: string) {
  return useQuery({
    queryKey: queryKeys.members(slug),
    queryFn: () => api.get<Paginated<Membership>>('/api/memberships/', { project: slug }),
  })
}

/**
 * Per-member visit and meeting counts.
 *
 * Not paginated — a project roster is tens of people, and both the chart and
 * the export need the whole set at once.
 */
export function useAttendance(slug: string) {
  return useQuery({
    queryKey: queryKeys.attendance(slug),
    queryFn: () => api.get<AttendanceRow[]>(`/api/projects/${slug}/attendance/`),
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
      void queryClient.invalidateQueries({ queryKey: queryKeys.attendance(projectSlug) })
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
      void queryClient.invalidateQueries({ queryKey: queryKeys.attendance(projectSlug) })
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
    },
  })
}
