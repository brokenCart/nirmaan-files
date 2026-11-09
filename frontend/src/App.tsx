import { lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

import { LoginPage } from '@/features/auth/LoginPage'
import { ProjectListPage } from '@/features/projects/ProjectListPage'
import { AppLayout } from '@/routes/AppLayout'
import { RequireAuth } from '@/routes/RequireAuth'

// One chunk per screen, so nobody downloads the Markdown renderer to read a
// timeline. The two pages everyone lands on stay in the entry chunk, where they
// paint without a second request.
const ProjectTimelinePage = lazy(() =>
  import('@/features/logs/ProjectTimelinePage').then((m) => ({ default: m.ProjectTimelinePage })),
)
const ProjectAttendancePage = lazy(() =>
  import('@/features/attendance/ProjectAttendancePage').then((m) => ({
    default: m.ProjectAttendancePage,
  })),
)
const ProjectArchivePage = lazy(() =>
  import('@/features/semesters/ProjectArchivePage').then((m) => ({
    default: m.ProjectArchivePage,
  })),
)
const ProjectResourcesPage = lazy(() =>
  import('@/features/resources/ProjectResourcesPage').then((m) => ({
    default: m.ProjectResourcesPage,
  })),
)
const ProjectReimbursementsPage = lazy(() =>
  import('@/features/reimbursements/ProjectReimbursementsPage').then((m) => ({
    default: m.ProjectReimbursementsPage,
  })),
)
const ProjectKnowledgePage = lazy(() =>
  import('@/features/knowledge/ProjectKnowledgePage').then((m) => ({
    default: m.ProjectKnowledgePage,
  })),
)
const ArticlePage = lazy(() =>
  import('@/features/knowledge/ArticlePage').then((m) => ({ default: m.ArticlePage })),
)

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<ProjectListPage />} />
        <Route path="/projects/:slug" element={<ProjectTimelinePage />} />
        <Route path="/projects/:slug/attendance" element={<ProjectAttendancePage />} />
        <Route path="/projects/:slug/archive" element={<ProjectArchivePage />} />
        <Route path="/projects/:slug/resources" element={<ProjectResourcesPage />} />
        <Route
          path="/projects/:slug/reimbursements"
          element={<ProjectReimbursementsPage />}
        />
        <Route path="/projects/:slug/knowledge" element={<ProjectKnowledgePage />} />
        <Route path="/projects/:slug/knowledge/:articleId" element={<ArticlePage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
