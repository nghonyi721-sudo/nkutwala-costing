import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { formatDate } from '../../lib/labels'
import Button from '../../components/Button'
import EmptyState from '../../components/EmptyState'
import { ClipboardTextIcon, PlusIcon } from '../../components/icons'
import Notice from '../../components/Notice'
import Page from '../../components/Page'
import { Row } from '../../components/Row'
import Section from '../../components/Section'
import Skeleton from '../../components/Skeleton'
import StatusBadge from '../../components/StatusBadge'
import ReportForm from './ReportForm'

// Site manager: their own reports, newest first. The database only ever
// returns this user's own reports.
// onShowList: called when a report opened from the "New report" tab is
// closed, so the tabs switch back to "My reports".
function MyReportsPage({ user, startNew, onShowList }) {
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
          if (startNew && onShowList) {
            onShowList()
            return
          }
          setOpen(null)
          setReloadCount((count) => count + 1)
        }}
      />
    )
  }

  return (
    <Page
      title="My reports"
      subtitle={
        reports
          ? `${reports.filter((r) => r.status === 'draft').length} draft · ${
              reports.filter((r) => r.status === 'submitted').length
            } submitted`
          : undefined
      }
      action={
        <Button variant="plain" inline icon={PlusIcon} onClick={() => setOpen('new')}>
          New
        </Button>
      }
    >
      {error && <Notice tone="error">{error}</Notice>}

      {!error && reports === undefined && <Skeleton />}

      {reports?.length === 0 && (
        <EmptyState
          icon={ClipboardTextIcon}
          title="No reports yet"
          text="Start today's daily report."
          action={<Button onClick={() => setOpen('new')}>New daily report</Button>}
        />
      )}

      {reports?.length > 0 && (
        <Section>
          {reports.map((report) => (
            <Row
              key={report.id}
              title={report.project?.name}
              subtitle={formatDate(report.report_date)}
              mono
              trailing={<StatusBadge status={report.status} />}
              chevron
              onClick={() => setOpen(report.id)}
            />
          ))}
        </Section>
      )}
    </Page>
  )
}

export default MyReportsPage
