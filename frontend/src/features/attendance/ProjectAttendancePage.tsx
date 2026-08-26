import { Download } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { ApiError, downloadFile } from '@/api/client'
import type { EffectiveRole } from '@/api/types'
import { Ornament } from '@/components/Logo'
import { Button, Card, EmptyState, ErrorNote, RoleBadge, Spinner } from '@/components/ui'
import { useAttendance, useProject } from '@/features/projects/queries'

import { AttendanceChart } from './AttendanceChart'
import type { Measure } from './measures'
import { MEASURE_LABELS, MEASURES, valueOf } from './measures'

export function ProjectAttendancePage() {
  const { slug = '' } = useParams()
  const [measure, setMeasure] = useState<Measure>('visits')
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  const project = useProject(slug)
  const attendance = useAttendance(slug)

  // Sorted by whatever is on screen, so the bars always read as a ranking.
  const rows = useMemo(() => {
    const data = attendance.data ?? []
    return [...data].sort((a, b) => valueOf(b, measure) - valueOf(a, measure))
  }, [attendance.data, measure])

  async function exportWorkbook() {
    setExporting(true)
    setExportError(null)
    try {
      await downloadFile(`/api/projects/${slug}/attendance/export/`, `${slug}-attendance.xlsx`)
    } catch (error) {
      setExportError(error instanceof ApiError ? error.detail : 'Could not build the export.')
    } finally {
      setExporting(false)
    }
  }

  if (project.isPending) return <Spinner label="Loading project…" />
  if (project.error) return <ErrorNote message={project.error.message} />
  if (!project.data) return <ErrorNote message="Project not found." />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to={`/projects/${slug}`} className="text-sm text-ink-mute hover:text-brand-600">
            ← {project.data.name} timeline
          </Link>
          <h1 className="mt-1 font-display text-2xl font-semibold text-ink">Attendance</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-soft">
            How many entries each member was present at. Counted from published entries only —
            drafts and removed entries do not appear here.
          </p>
        </div>

        <Button onClick={() => void exportWorkbook()} disabled={exporting || rows.length === 0}>
          <Download className="size-4" aria-hidden />
          {exporting ? 'Preparing…' : 'Export to Excel'}
        </Button>
      </div>

      {exportError && <ErrorNote message={exportError} />}

      {attendance.isPending ? (
        <Spinner label="Counting attendance…" />
      ) : attendance.error ? (
        <ErrorNote message={attendance.error.message} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No members yet"
          description="Add people to this project and their attendance will appear here."
        />
      ) : (
        <>
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-display text-lg font-semibold text-brand-600">
                {MEASURE_LABELS[measure]} per member
              </h2>

              <div
                className="flex gap-1 rounded-full border border-line bg-paper/60 p-1"
                role="group"
                aria-label="Choose what the chart shows"
              >
                {MEASURES.map((option) => (
                  <Button
                    key={option}
                    variant={measure === option ? 'primary' : 'ghost'}
                    aria-pressed={measure === option}
                    onClick={() => setMeasure(option)}
                  >
                    {MEASURE_LABELS[option]}
                  </Button>
                ))}
              </div>
            </div>

            <Ornament className="mt-2 mb-5" />
            <AttendanceChart rows={rows} measure={measure} />
          </Card>

          <Card className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">
                Visits, meetings and total entries attended by each member of {project.data.name}
              </caption>
              <thead>
                <tr className="border-b border-line text-left text-xs tracking-wide text-ink-soft uppercase">
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Member
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Role
                  </th>
                  {MEASURES.map((column) => (
                    <th key={column} scope="col" className="py-2 pl-4 text-right font-semibold">
                      {MEASURE_LABELS[column]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.user.id} className="border-b border-line/60 last:border-0">
                    <th scope="row" className="py-2.5 pr-4 text-left font-normal">
                      <span className="block text-ink">{row.user.full_name || '—'}</span>
                      <span className="block text-xs text-ink-mute">{row.user.email}</span>
                    </th>
                    <td className="py-2.5 pr-4">
                      <RoleBadge role={row.role as EffectiveRole} />
                    </td>
                    {MEASURES.map((column) => (
                      <td
                        key={column}
                        className={
                          column === measure
                            ? 'py-2.5 pl-4 text-right font-semibold text-ink tabular-nums'
                            : 'py-2.5 pl-4 text-right text-ink-soft tabular-nums'
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
  )
}
