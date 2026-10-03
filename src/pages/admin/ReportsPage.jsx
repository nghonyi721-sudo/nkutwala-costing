import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { formatDate, REPORT_STATUS_LABELS } from '../../lib/labels'
import ChoiceButtons from '../../components/ChoiceButtons'
import ReportView from './ReportView'

const ALL_PROJECTS = 'all'

// Owner/admin: every report in the company, filterable by project and date.
function ReportsPage({ onBack }) {
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
      <button type="button" className="btn-secondary btn-back" onClick={onBack}>
        ← Back
      </button>
      <h1>Daily reports</h1>

      <ChoiceButtons
        label="Project"
        options={projectOptions}
        value={projectFilter}
        onChange={setProjectFilter}
      />

      <label htmlFor="date-filter">Date</label>
      <div className="date-filter">
        <input
          id="date-filter"
          type="date"
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
        />
        {dateFilter && (
          <button type="button" className="btn-secondary" onClick={() => setDateFilter('')}>
            Clear
          </button>
        )}
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {!error && reports === undefined && <p className="loading">Loading…</p>}

      {reports?.length === 0 && <p>No reports match.</p>}

      {reports?.length > 0 && (
        <ul className="list">
          {reports.map((report) => (
            <li key={report.id}>
              <button type="button" className="list-item" onClick={() => setOpenId(report.id)}>
                <span className="list-title">{report.project?.name}</span>
                <span className="list-detail">
                  {formatDate(report.report_date)} · {report.reporter?.full_name}
                </span>
                <span className={`badge ${report.status}`}>
                  {REPORT_STATUS_LABELS[report.status]}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default ReportsPage
