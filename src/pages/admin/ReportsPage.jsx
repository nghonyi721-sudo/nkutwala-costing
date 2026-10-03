import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { formatDate } from '../../lib/labels'
import Button from '../../components/Button'
import ChoiceButtons from '../../components/ChoiceButtons'
import DataTable from '../../components/DataTable'
import Field from '../../components/Field'
import StatusTag from '../../components/StatusTag'
import ReportView from './ReportView'

const ALL_PROJECTS = 'all'

const REPORT_COLUMNS = [
  { key: 'report_date', label: 'Date', mono: true, render: (r) => formatDate(r.report_date) },
  {
    key: 'project',
    label: 'Project',
    render: (r) => (
      <>
        {r.project?.name}
        <span className="cell-detail">{r.reporter?.full_name}</span>
      </>
    ),
  },
  { key: 'status', label: 'Status', render: (r) => <StatusTag status={r.status} /> },
]

// Owner/admin: every report in the company, filterable by project and date.
function ReportsPage() {
  const [projects, setProjects] = useState([])
  const [projectFilter, setProjectFilter] = useState(ALL_PROJECTS)
  const [dateFilter, setDateFilter] = useState('')

  // undefined = loading, array = loaded
  const [reports, setReports] = useState(undefined)
  const [error, setError] = useState('')
  const [openId, setOpenId] = useState(null)
  const [reloadCount, setReloadCount] = useState(0)

  useEffect(() => {
    supabase
      .from('projects')
      .select('id, name')
      .order('name')
      .then(({ data }) => setProjects(data ?? []))
  }, [])

  useEffect(() => {
    let cancelled = false

    let query = supabase
      .from('daily_reports')
      .select(
        'id, report_date, status, project:projects(name), reporter:profiles!daily_reports_reporter_id_fkey(full_name)',
      )
      .order('report_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(200)
    if (projectFilter !== ALL_PROJECTS) query = query.eq('project_id', projectFilter)
    if (dateFilter) query = query.eq('report_date', dateFilter)

    query.then(({ data, error: loadError }) => {
      if (cancelled) return
      if (loadError) {
        setError('Could not load reports. Check your signal and try again.')
      } else {
        setError('')
        setReports(data)
      }
    })

    return () => {
      cancelled = true
    }
  }, [projectFilter, dateFilter, reloadCount])

  if (openId) {
    return (
      <ReportView
        reportId={openId}
        onBack={() => {
          setOpenId(null)
          setReloadCount((count) => count + 1)
        }}
      />
    )
  }

  const projectOptions = {
    [ALL_PROJECTS]: 'All projects',
    ...Object.fromEntries(projects.map((p) => [p.id, p.name])),
  }

  return (
    <div className="card">
      <h1>Daily reports</h1>

      <ChoiceButtons
        label="Project"
        options={projectOptions}
        value={projectFilter}
        onChange={setProjectFilter}
      />

      <div className="date-filter">
        <Field
          id="date-filter"
          label="Date"
          type="date"
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
        />
        {dateFilter && (
          <Button variant="secondary" inline onClick={() => setDateFilter('')}>
            Clear
          </Button>
        )}
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {!error && reports === undefined && <p className="loading">Loading…</p>}

      {reports?.length === 0 && <p className="label">No reports match.</p>}

      {reports?.length > 0 && (
        <DataTable
          caption="Daily reports"
          columns={REPORT_COLUMNS}
          rows={reports}
          onRowClick={(report) => setOpenId(report.id)}
        />
      )}
    </div>
  )
}

export default ReportsPage
