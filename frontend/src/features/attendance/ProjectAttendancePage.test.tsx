import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { AttendanceRow } from '@/api/types'
import { ProjectAttendancePage } from '@/features/attendance/ProjectAttendancePage'
import { makeAttendanceRow, makeProject, makeSemester, makeUser } from '@/test/factories'
import { currentLocation, paginated, renderApp, stubApi } from '@/test/render'
import type { Reply } from '@/test/render'

vi.mock('@/auth/AuthContext', () => ({
  useAuth: () => ({ roleIn: () => 'VOLUNTEER' }),
}))

const open = makeSemester({ id: 10, slug: 'open', name: 'First Semester' })
const old = makeSemester({ id: 9, slug: 'old', name: 'Old Semester', is_current: false })

const frequentVisitor = makeAttendanceRow({
  user: makeUser({ id: 1, full_name: 'Frequent Visitor' }),
  visits: 5,
  meetings: 0,
  total: 5,
  hours: 5,
})
const longHours = makeAttendanceRow({
  user: makeUser({ id: 2, full_name: 'Long Hours' }),
  visits: 2,
  meetings: 0,
  total: 2,
  hours: 12.5,
})

function show(rows: AttendanceRow[], route = '/projects/shiksha/attendance') {
  const calls = stubApi({
    'GET /api/projects/shiksha/': { body: makeProject() },
    'GET /api/semesters/': { body: { count: 2, next: null, previous: null, results: [open, old] } },
    'GET /api/semesters/current/': { body: open },
    'GET /api/projects/shiksha/attendance/': { body: rows },
  })
  renderApp(<ProjectAttendancePage />, { route, path: '/projects/:slug/attendance' })
  return calls
}

const chartOrder = () =>
  Array.from(screen.getByRole('img').querySelectorAll<HTMLElement>('span[title]')).map(
    (name) => name.title,
  )

describe('ProjectAttendancePage', () => {
  it('ranks by visits first', async () => {
    show([longHours, frequentVisitor])
    await screen.findByRole('table')
    expect(chartOrder()).toEqual(['Frequent Visitor', 'Long Hours'])
  })

  it('re-ranks when the chart switches to hours', async () => {
    show([frequentVisitor, longHours])
    await screen.findByRole('table')

    await userEvent.click(screen.getByRole('button', { name: 'Hours' }))

    expect(screen.getByRole('heading', { name: 'Hours per member' })).toBeInTheDocument()
    expect(chartOrder()).toEqual(['Long Hours', 'Frequent Visitor'])
  })

  it('lists hours in the table', async () => {
    show([longHours])
    const table = await screen.findByRole('table')

    expect(within(table).getByRole('columnheader', { name: 'Hours' })).toBeInTheDocument()
    expect(within(table).getByRole('cell', { name: '12.5' })).toBeInTheDocument()
  })

  it('asks for the term in the URL', async () => {
    const calls = show([longHours], '/projects/shiksha/attendance?semester=old')
    await screen.findByRole('table')

    const request = calls.find((call) => call.path.endsWith('/attendance/'))
    expect(request?.query.get('semester')).toBe('old')
  })

  describe('export', () => {
    function captureDownload() {
      Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() })
      const names: string[] = []
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
        this: HTMLAnchorElement,
      ) {
        names.push(this.download)
      })
      return names
    }

    function showWithExport(reply: Reply, route = '/projects/shiksha/attendance') {
      const calls = stubApi({
        'GET /api/projects/shiksha/': { body: makeProject() },
        'GET /api/semesters/': { body: paginated([open, old]) },
        'GET /api/semesters/current/': { body: open },
        'GET /api/projects/shiksha/attendance/': { body: [longHours] },
        'GET /api/projects/shiksha/attendance/export/': reply,
      })
      renderApp(<ProjectAttendancePage />, { route, path: '/projects/:slug/attendance' })
      return calls
    }

    it('downloads the open term under a plain name', async () => {
      const names = captureDownload()
      showWithExport({})
      await screen.findByRole('table')

      await userEvent.click(screen.getByRole('button', { name: /Export/ }))

      await waitFor(() => expect(names).toEqual(['shiksha-attendance.xlsx']))
    })

    it('asks for the viewed term and names the file after it', async () => {
      const names = captureDownload()
      const calls = showWithExport({}, '/projects/shiksha/attendance?semester=old')
      await screen.findByRole('table')

      await userEvent.click(screen.getByRole('button', { name: /Export/ }))

      await waitFor(() => expect(names).toEqual(['shiksha-old-attendance.xlsx']))
      const request = calls.find((call) => call.path.endsWith('/export/'))
      expect(request?.query.get('semester')).toBe('old')
    })

    it('shows a failed export', async () => {
      showWithExport({ status: 500, body: { detail: 'Export broke.' } })
      await screen.findByRole('table')

      await userEvent.click(screen.getByRole('button', { name: /Export/ }))

      expect(await screen.findByRole('alert')).toHaveTextContent('Export broke.')
      expect(screen.getByRole('button', { name: /Export/ })).toBeEnabled()
    })
  })

  it('names the term in the heading', async () => {
    show([longHours])
    expect(
      await screen.findByRole('heading', { name: 'Attendance in First Semester' }),
    ).toBeInTheDocument()
  })

  it('switches term through the URL', async () => {
    show([longHours])
    await screen.findByRole('table')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: /semester/i }))
    await user.click(screen.getByRole('option', { name: 'Old Semester' }))

    expect(currentLocation()).toBe('/projects/shiksha/attendance?semester=old')
  })

  it('shows counts that failed to load', async () => {
    stubApi({
      'GET /api/projects/shiksha/': { body: makeProject() },
      'GET /api/semesters/': { body: paginated([open]) },
      'GET /api/semesters/current/': { body: open },
      'GET /api/projects/shiksha/attendance/': { status: 500, body: { detail: 'Counts broke.' } },
    })
    renderApp(<ProjectAttendancePage />, {
      route: '/projects/shiksha/attendance',
      path: '/projects/:slug/attendance',
    })
    expect(await screen.findByRole('alert')).toHaveTextContent('Counts broke.')
  })

  it('explains an empty roster', async () => {
    show([])
    expect(await screen.findByText('No members this semester')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Export/ })).toBeDisabled()
  })
})
