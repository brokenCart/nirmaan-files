import { Navigate, Route, Routes } from 'react-router-dom'

import { ProjectAttendancePage } from '@/features/attendance/ProjectAttendancePage'
import { LoginPage } from '@/features/auth/LoginPage'
import { ProjectTimelinePage } from '@/features/logs/ProjectTimelinePage'
import { ProjectListPage } from '@/features/projects/ProjectListPage'
import { ProjectArchivePage } from '@/features/semesters/ProjectArchivePage'
import { AppLayout } from '@/routes/AppLayout'
import { RequireAuth } from '@/routes/RequireAuth'

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
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
