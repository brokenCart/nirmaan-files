import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '@/api/client'
import type {
  ArchiveTerm,
  Article,
  ArticleCategory,
  ArticleInput,
  ArticleListItem,
  ArticlePatch,
  ArticleRevision,
  AttendanceRow,
  DailyLog,
  DailyLogInput,
  DailyLogPatch,
  Membership,
  MembershipInput,
  Paginated,
  Project,
  Reimbursement,
  ReimbursementInput,
  ReimbursementPatch,
  ReimbursementReview,
  ReimbursementSummary,
  Resource,
  ResourceInput,
  ResourcePatch,
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
  // Resources carry no semester — the shelf is the same one every term — so
  // the project slug is the whole key.
  resources: (slug: string) => ['resources', slug] as const,
  // Articles carry no semester either, but the index is filtered, so the
  // filters are part of the key.
  articles: (slug: string, filters: ArticleFilters) => ['articles', slug, filters] as const,
  /** Prefix matching every filtered view of one project's index. */
  articlesForProject: (slug: string) => ['articles', slug] as const,
  /**
   * One page and its history.
   *
   * The history hangs off the same prefix so that invalidating a page after an
   * edit clears the version list too — an edit is precisely what adds to it.
   */
  article: (id: number) => ['article', id] as const,
  articleRevisions: (id: number) => ['article', id, 'revisions'] as const,
  /**
   * One project's queue, and the counts beside it.
   *
   * The filters are part of the key, and the term among them: reimbursements
   * are semester-scoped like logs and unlike the shelf, so switching terms must
   * not read the previous one's rows from cache.
   */
  reimbursements: (slug: string, filters: ReimbursementFilters) =>
    ['reimbursements', slug, filters] as const,
  /**
   * Prefix matching every filtered and paged view of one project's queue.
   *
   * Invalidation uses this rather than a fully-specified key: a review moves a
   * row between status tabs, so the tab it left and the tab it arrived on are
   * both stale, and so is the summary.
   */
  reimbursementsForProject: (slug: string) => ['reimbursements', slug] as const,
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

/**
 * Rows per page of `/api/reimbursements/`.
 *
 * Mirrors `ReimbursementPagination.page_size`, for the reason
 * {@link LOGS_PAGE_SIZE} mirrors the timeline's: DRF reports `count` but not
 * the page size, and the SPA needs the size to turn one into a page total.
 * Change both together.
 */
export const REIMBURSEMENTS_PAGE_SIZE = 20

/** Filters accepted by the reimbursement queue. */
export type ReimbursementFilters = {
  status?: string
  /** A semester slug, or `all`. Defaults to the open term. */
  semester?: string
  /** `true` narrows a finance lead's view to their own requests. */
  mine?: string
  page?: number
} & Record<string, string | number | undefined>

/** Filters accepted by the unpaginated knowledge-base index. */
export type ArticleFilters = {
  q?: string
  category?: ArticleCategory
} & Record<string, string | undefined>

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

/**
 * Takes one person off a project's roster for one term.
 *
 * The server also deletes the underlying user when the row was an unclaimed
 * placeholder nothing else points at — see `discard_placeholder_user`. Nothing
 * here needs to know which happened; both outcomes are a 204 and the same
 * invalidations.
 */
export function useRemoveMember(projectSlug: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<void>(`/api/memberships/${id}/`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.membersForProject(projectSlug) })
      // They drop out of the attendance table, and the archive's roster size.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.attendanceForProject(projectSlug),
      })
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

/**
 * A project's shelf of links.
 *
 * Not paginated: `ResourceViewSet` returns the whole shelf, because a
 * reference list is scanned rather than read and paging one hides half of it
 * behind a control nobody expects on this screen.
 */
export function useResources(slug: string) {
  return useQuery({
    queryKey: queryKeys.resources(slug),
    queryFn: () => api.get<Resource[]>('/api/resources/', { project: slug }),
  })
}

/**
 * Adds one link to a project's shelf.
 *
 * Only the shelf goes stale. Resources are not counted anywhere and belong to
 * no term, so neither the attendance table nor the archive is touched — the
 * broad invalidation the log mutations do would be waste here.
 */
export function useCreateResource(projectSlug: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: ResourceInput) => api.post<Resource>('/api/resources/', body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.resources(projectSlug) })
    },
  })
}

export function useUpdateResource(projectSlug: string) {
  const queryClient = useQueryClient()
  return useMutation({
    // PATCH rather than PUT: the form carries only the editable fields, and
    // the server owns `added_by` and the timestamps.
    mutationFn: ({ id, ...body }: ResourcePatch & { id: number }) =>
      api.patch<Resource>(`/api/resources/${id}/`, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.resources(projectSlug) })
    },
  })
}

/** Removes a link. Hard on the server, unlike a log's soft delete. */
export function useDeleteResource(projectSlug: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<void>(`/api/resources/${id}/`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.resources(projectSlug) })
    },
  })
}

/**
 * A project's knowledge base index.
 *
 * Not paginated, like the shelf: `ArticleViewSet` returns the whole set,
 * because a knowledge base is scanned for the one page you came for. The rows
 * carry an excerpt rather than a body, so the whole of one is a small response
 * — which is what makes returning all of it reasonable.
 */
export function useArticles(slug: string, filters: ArticleFilters = {}) {
  return useQuery({
    queryKey: queryKeys.articles(slug, filters),
    queryFn: () => api.get<ArticleListItem[]>('/api/articles/', { project: slug, ...filters }),
    // Hold the current results while a new search runs, so typing does not
    // flash the list to a spinner on every keystroke.
    placeholderData: keepPreviousData,
  })
}

/** One page in full. The index deliberately does not carry the body. */
export function useArticle(id: number) {
  return useQuery({
    queryKey: queryKeys.article(id),
    queryFn: () => api.get<Article>(`/api/articles/${id}/`),
  })
}

/**
 * Every saved version of one page, newest first.
 *
 * `enabled` so the history is fetched when the reader opens it rather than on
 * every page view: the bodies travel with the revisions, which is what lets the
 * SPA preview and restore one without a request each, and also what makes it
 * the largest response in the module.
 */
export function useArticleRevisions(id: number, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.articleRevisions(id),
    queryFn: () => api.get<ArticleRevision[]>(`/api/articles/${id}/revisions/`),
    enabled,
  })
}

export function useCreateArticle(projectSlug: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: ArticleInput) => api.post<Article>('/api/articles/', body),
    onSuccess: () => {
      // Only the index goes stale. Articles belong to no term and are counted
      // nowhere, so neither the attendance table nor the archive is touched.
      void queryClient.invalidateQueries({ queryKey: queryKeys.articlesForProject(projectSlug) })
    },
  })
}

/**
 * Saves an edit — including a restore, which is an ordinary edit carrying an
 * older body. There is no restore endpoint, so there is no restore mutation.
 */
export function useUpdateArticle(projectSlug: string) {
  const queryClient = useQueryClient()
  return useMutation({
    // PATCH rather than PUT: the form carries only the editable fields, and the
    // server owns authorship, the timestamps and the revision it writes.
    mutationFn: ({ id, ...body }: ArticlePatch & { id: number }) =>
      api.patch<Article>(`/api/articles/${id}/`, body),
    onSuccess: (article) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.articlesForProject(projectSlug) })
      // The page itself and its history, which this edit has just added to.
      void queryClient.invalidateQueries({ queryKey: queryKeys.article(article.id) })
    },
  })
}

/** Removes a page. Soft on the server, like a log and unlike a link. */
export function useDeleteArticle(projectSlug: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<void>(`/api/articles/${id}/`),
    onSuccess: (_result, id) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.articlesForProject(projectSlug) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.article(id) })
    },
  })
}

/**
 * One project's reimbursement queue for one term.
 *
 * Paginated, unlike the shelf and the knowledge index — those are bounded by a
 * project's own tidiness and this is not, because nobody prunes last month's
 * claims. What the reader sees depends on who they are: the server returns a
 * volunteer their own requests and a lead or finance lead the whole queue, so
 * there is nothing to filter here.
 */
export function useReimbursements(slug: string, filters: ReimbursementFilters = {}) {
  return useQuery({
    queryKey: queryKeys.reimbursements(slug, filters),
    queryFn: () =>
      api.get<Paginated<Reimbursement>>('/api/reimbursements/', { project: slug, ...filters }),
    // Hold the current page while the next loads, so switching status tabs does
    // not collapse the list to a spinner.
    placeholderData: keepPreviousData,
  })
}

/**
 * How many requests sit in each state.
 *
 * A request of its own rather than a count off the list, because the list is
 * paginated: "3 awaiting review" must not become "2" when the reader turns the
 * page. The server runs the identical visibility rules, so a volunteer's counts
 * are of their own requests.
 *
 * Deliberately does not take `status` — it is a count *per* status, and the
 * server ignores that filter for the same reason.
 */
export function useReimbursementSummary(slug: string, filters: ReimbursementFilters = {}) {
  const { status: _status, page: _page, ...rest } = filters
  return useQuery({
    queryKey: [...queryKeys.reimbursementsForProject(slug), 'summary', rest] as const,
    queryFn: () =>
      api.get<ReimbursementSummary>('/api/reimbursements/summary/', { project: slug, ...rest }),
  })
}

export function useCreateReimbursement(projectSlug: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: ReimbursementInput) =>
      api.post<Reimbursement>('/api/reimbursements/', body),
    onSuccess: () => {
      // Only the queue and its counts. Reimbursements are not counted in the
      // attendance table and do not appear in the archive's per-term totals,
      // so the broader invalidation the log mutations do would be waste.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.reimbursementsForProject(projectSlug),
      })
    },
  })
}

export function useUpdateReimbursement(projectSlug: string) {
  const queryClient = useQueryClient()
  return useMutation({
    // PATCH rather than PUT: the form carries the two editable fields, and the
    // server owns the submitter, the term and the whole decision.
    mutationFn: ({ id, ...body }: ReimbursementPatch & { id: number }) =>
      api.patch<Reimbursement>(`/api/reimbursements/${id}/`, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.reimbursementsForProject(projectSlug),
      })
    },
  })
}

/**
 * Approves or rejects one request.
 *
 * Its own endpoint rather than a PATCH of `status`, mirroring the server: the
 * person allowed to do this is precisely the person not allowed to edit the
 * request, so the two are different calls under different rules.
 */
export function useReviewReimbursement(projectSlug: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: ReimbursementReview & { id: number }) =>
      api.post<Reimbursement>(`/api/reimbursements/${id}/review/`, body),
    onSuccess: () => {
      // A decision moves the row between status tabs, so the tab it left, the
      // tab it arrived on and the counts are all stale. The prefix clears them
      // together rather than guessing which cached filters were affected.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.reimbursementsForProject(projectSlug),
      })
    },
  })
}

/** Withdraws or removes a request. Soft on the server, like a log. */
export function useDeleteReimbursement(projectSlug: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<void>(`/api/reimbursements/${id}/`),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.reimbursementsForProject(projectSlug),
      })
    },
  })
}
