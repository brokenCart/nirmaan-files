import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '@/api/client'
import type { DailyLog, Membership, Paginated, Project } from '@/api/types'

export const queryKeys = {
  projects: ['projects'] as const,
  project: (slug: string) => ['projects', slug] as const,
  logs: (filters: LogFilters) => ['logs', filters] as const,
  members: (slug: string) => ['memberships', slug] as const,
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

export function useCreateLog(projectSlug: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: Partial<DailyLog>) => api.post<DailyLog>('/api/logs/', body),
    onSuccess: () => {
      // The timeline is filtered several ways; invalidate the whole namespace
      // rather than guessing which cached filter combinations went stale.
      void queryClient.invalidateQueries({ queryKey: ['logs'] })
      void queryClient.invalidateQueries({ queryKey: queryKeys.project(projectSlug) })
    },
  })
}

export function useDeleteLog() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<void>(`/api/logs/${id}/`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['logs'] }),
  })
}
