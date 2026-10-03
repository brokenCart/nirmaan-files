import { Download } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'

import { ApiError, downloadFile } from '@/api/client'
import type { EffectiveRole } from '@/api/types'
import { ProjectHeader } from '@/components/ProjectHeader'
import {
  Button,
  Card,
  EmptyState,
  ErrorNote,
  RoleBadge,
  SectionIntro,
  Segmented,
  Spinner,
} from '@/components/ui'
import {
  useAttendance,
  useCurrentSemester,
  useProject,
  useSemesters,
} from '@/features/projects/queries'
import { SemesterSwitcher } from '@/features/semesters/SemesterSwitcher'

import { AttendanceChart } from './AttendanceChart'
import type { Measure } from './measures'
import { MEASURE_LABELS, MEASURES, valueOf } from './measures'

export function ProjectAttendancePage() {
  const { slug = '' } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const [measure, setMeasure] = useState<Measure>('visits')
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  const viewedTerm = searchParams.get('semester') ?? undefined

  const project = useProject(slug)
  const semesters = useSemesters()
  const currentSemester = useCurrentSemester()
  const attendance = useAttendance(slug, viewedTerm)

  const termName =
    semesters.data?.results.find((s) => s.slug === (viewedTerm ?? currentSemester.data?.slug))
      ?.name ?? ''

  // Sorted by whatever is on screen, so the bars always read as a ranking.
  const rows = useMemo(() => {
    const data = attendance.data ?? []
    return [...data].sort((a, b) => valueOf(b, measure) - valueOf(a, measure))
  }, [attendance.data, measure])

  async function exportWorkbook() {
    setExporting(true)
    setExportError(null)
    try {
      const query = viewedTerm ? `?semester=${viewedTerm}` : ''
      // The term is in the local filename too: two terms of the same project
      // would otherwise overwrite each other in the downloads folder.
      const name = viewedTerm ? `${slug}-${viewedTerm}-attendance.xlsx` : `${slug}-attendance.xlsx`
      await downloadFile(`/api/projects/${slug}/attendance/export/${query}`, name)
    } catch (error) {
      setExportError(
        error instanceof ApiError ? error.detail : 'Couldn’t create the Excel file. Try again.',
      )
    } finally {
      setExporting(false)
    }
  }

  if (project.isPending) return <Spinner label="Loading project…" />
  if (project.error) return <ErrorNote message={project.error.message} />
  if (!project.data) return <ErrorNote message="Project not found." />

  return (
    <div>
      <ProjectHeader project={project.data} />

      <div className="space-y-6">
        <SectionIntro
          title={termName ? `Attendance in ${termName}` : 'Attendance'}
          description="Visits and meetings each member attended this semester. Drafts aren’t counted."
          actions={
            <Button
              variant="secondary"
              onClick={() => void exportWorkbook()}
              disabled={exporting || rows.length === 0}
            >
              <Download className="size-4" aria-hidden />
              {exporting ? 'Preparing…' : 'Export to Excel'}
            </Button>
          }
        />

        {semesters.data && semesters.data.results.length > 1 && (
          <SemesterSwitcher
            semesters={semesters.data.results}
            value={viewedTerm}
            current={currentSemester.data}
            onChange={(next) => setSearchParams(next ? { semester: next } : {}, { replace: true })}
            archiveHref={`/projects/${slug}/archive`}
          />
        )}

        {exportError && <ErrorNote message={exportError} />}

        {attendance.isPending ? (
          <Spinner label="Counting attendance…" />
        ) : attendance.error ? (
          <ErrorNote message={attendance.error.message} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No members this semester"
            description="Add members on the Timeline tab to track their attendance."
          />
        ) : (
          <>
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-xl font-semibold text-ink">
                  {MEASURE_LABELS[measure]} per member
                </h3>

                <Segmented
                  options={MEASURES}
                  value={measure}
                  onChange={setMeasure}
                  label="Choose what the chart shows"
                  renderLabel={(option) => MEASURE_LABELS[option]}
                />
              </div>

              <div className="mt-6" />
              <AttendanceChart rows={rows} measure={measure} />
            </Card>

            <Card className="overflow-x-auto p-0 sm:p-0">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  Visits, meetings and total entries attended by each member of {project.data.name}
                </caption>
                <thead>
                  <tr className="border-b border-line bg-paper/60 text-left text-sm text-ink-soft">
                    <th scope="col" className="py-2.5 pr-4 pl-5 font-medium">
                      Member
                    </th>
                    <th scope="col" className="py-2.5 pr-4 font-medium">
                      Role
                    </th>
                    {MEASURES.map((column) => (
                      <th
                        key={column}
                        scope="col"
                        className="py-2.5 pr-5 pl-4 text-right font-medium"
                      >
                        {MEASURE_LABELS[column]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.user.id}
                      className="border-b border-line/60 last:border-0 even:bg-stripe"
                    >
                      <th scope="row" className="py-3 pr-4 pl-5 text-left font-normal">
                        <span className="block text-ink">{row.user.full_name || '—'}</span>
                        <span className="block text-sm text-ink-mute">{row.user.email}</span>
                      </th>
                      <td className="py-3 pr-4">
                        <RoleBadge role={row.role as EffectiveRole} />
                      </td>
                      {MEASURES.map((column) => (
                        <td
                          key={column}
                          className={
                            column === measure
                              ? 'py-3 pr-5 pl-4 text-right font-semibold text-ink tabular-nums'
                              : 'py-3 pr-5 pl-4 text-right text-ink-soft tabular-nums'
                          }
                        >
                          {valueOf(row, column)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </>
        )}
      </div>
    </div>
  )
}
