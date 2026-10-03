import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { formatDate } from '../../lib/labels'
import Button from '../../components/Button'
import StatusTag from '../../components/StatusTag'
import ListRow from '../../components/ListRow'
import PageHeader from '../../components/PageHeader'
import Skeleton from '../../components/Skeleton'
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
      <PageHeader
        eyebrow="Site"
        title="My reports"
        meta={
          reports
            ? `${reports.filter((r) => r.status === 'draft').length} draft · ${
                reports.filter((r) => r.status === 'submitted').length
              } submitted`
            : null
        }
      />

      <Button onClick={() => setOpen('new')}>New daily report</Button>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {!error && reports === undefined && <Skeleton />}

      {reports?.length === 0 && <p className="label">No reports yet. Tap New daily report to start today's.</p>}

      {reports?.length > 0 && (
        <ul className="list">
          {reports.map((report) => (
            <li key={report.id}>
              <ListRow
                title={report.project?.name}
                detail={formatDate(report.report_date)}
                mono
                tag={<StatusTag status={report.status} />}
                onClick={() => setOpen(report.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default MyReportsPage
