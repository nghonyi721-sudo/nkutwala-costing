import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { formatDate } from '../../lib/labels'
import Button from '../../components/Button'
import StatusTag from '../../components/StatusTag'
import ReportForm from './ReportForm'

// Site manager: their own reports, newest first. The database only ever
// returns this user's own reports.
function MyReportsPage({ user, startNew }) {
  // undefined = loading, array = loaded
  const [reports, setReports] = useState(undefined)
  const [error, setError] = useState('')
  // null = show the list, 'new' = new report, a report id = open it
  const [open, setOpen] = useState(startNew ? 'new' : null)
  const [reloadCount, setReloadCount] = useState(0)

  useEffect(() => {
    let cancelled = false

    supabase
      .from('daily_reports')
      .select('id, report_date, status, project:projects(name)')
      .eq('reporter_id', user.id)
      .order('report_date', { ascending: false })
      .order('created_at', { ascending: false })
      .then(({ data, error: loadError }) => {
        if (cancelled) return
        if (loadError) {
          setError('Could not load your reports. Check your signal and try again.')
        } else {
          setError('')
          setReports(data)
        }
      })

    return () => {
      cancelled = true
    }
  }, [user.id, reloadCount])

  if (open) {
    return (
      <ReportForm
        user={user}
        reportId={open === 'new' ? null : open}
        onDone={() => {
          setOpen(null)
          setReloadCount((count) => count + 1)
        }}
      />
    )
  }

  return (
    <div className="card">
      <h1>My reports</h1>

      <Button onClick={() => setOpen('new')}>New daily report</Button>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {!error && reports === undefined && <p className="loading">Loading…</p>}

      {reports?.length === 0 && <p className="label">No reports yet.</p>}

      {reports?.length > 0 && (
        <ul className="list">
          {reports.map((report) => (
            <li key={report.id}>
              <button type="button" className="list-item" onClick={() => setOpen(report.id)}>
                <span className="list-title">{report.project?.name}</span>
                <span className="list-detail num">{formatDate(report.report_date)}</span>
                <StatusTag status={report.status} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default MyReportsPage
