import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { fetchReport } from '../../lib/reports'
import { formatDate } from '../../lib/labels'
import ActionBar from '../../components/ActionBar'
import Button from '../../components/Button'
import { ArrowCounterClockwiseIcon } from '../../components/icons'
import Notice from '../../components/Notice'
import Page from '../../components/Page'
import ReportSummary from '../../components/ReportSummary'
import { FieldRow } from '../../components/Row'
import Sheet, { SheetGroup } from '../../components/Sheet'
import Skeleton from '../../components/Skeleton'

// Owner/admin: one report, read-only. A submitted report can be reopened
// (with a reason) so the site manager can correct it. The database keeps
// the submitted version in the audit log.
//   readOnly:    no Reopen button (e.g. when opened from the dashboard drill-down)
//   breadcrumbs: shown at the top (the drill-down's <Breadcrumbs>)
function ReportView({ reportId, onBack, backLabel = 'Reports', readOnly = false, breadcrumbs }) {
  // undefined = loading, null = not found, object = loaded
  const [report, setReport] = useState(undefined)
  const [loadError, setLoadError] = useState('')
  const [reloadCount, setReloadCount] = useState(0)

  const [reopening, setReopening] = useState(false)
  const [reason, setReason] = useState('')
  const [reopenError, setReopenError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false

    fetchReport(reportId).then(({ data, error }) => {
      if (cancelled) return
      if (error) {
        setLoadError('Could not load the report. Check your signal and try again.')
      } else {
        setLoadError('')
        setReport(data)
      }
    })

    return () => {
      cancelled = true
    }
  }, [reportId, reloadCount])

  async function reopen() {
    if (!reason.trim()) {
      setReopenError('Enter a reason for reopening.')
      return
    }

    setReopenError('')
    setBusy(true)
    const { data, error } = await supabase
      .from('daily_reports')
      .update({ status: 'draft', reopen_reason: reason.trim() })
      .eq('id', reportId)
      .eq('status', 'submitted')
      .select('id')
    setBusy(false)

    if (error || data.length === 0) {
      setReopenError('Could not reopen the report. Check your signal and try again.')
    } else {
      setReopening(false)
      setReason('')
      setReloadCount((count) => count + 1)
    }
  }

  return (
    <Page
      title={report?.project?.name ?? 'Daily report'}
      subtitle={
        report ? `${formatDate(report.report_date)} · ${report.reporter?.full_name ?? ''}` : undefined
      }
      onBack={onBack}
      backLabel={backLabel}
      footer={
        report?.status === 'submitted' && !readOnly ? (
          <ActionBar>
            <Button
              variant="danger"
              icon={ArrowCounterClockwiseIcon}
              onClick={() => {
                setReopenError('')
                setReopening(true)
              }}
            >
              Reopen report
            </Button>
          </ActionBar>
        ) : undefined
      }
    >
      {breadcrumbs}
      {loadError && <Notice tone="error">{loadError}</Notice>}
      {!loadError && report === undefined && <Skeleton rows={4} />}
      {report === null && <Notice tone="error">Report not found.</Notice>}

      {report?.status === 'draft' && (
        <Notice tone="info">This report is a draft. The site manager can still change it.</Notice>
      )}

      {report && <ReportSummary report={report} />}

      {reopening && (
        <Sheet
          title="Reopen report"
          hint="The site manager will be able to change it again. The submitted version is kept in the audit log."
          cancelLabel="Cancel"
          showDone={false}
          onClose={() => setReopening(false)}
          footer={
            <Button variant="danger" busy={busy} onClick={reopen}>
              {busy ? 'Reopening…' : 'Reopen report'}
            </Button>
          }
        >
          <SheetGroup>
            <FieldRow
              label="Reason"
              placeholder="What needs fixing?"
              inputWidth="62%"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </SheetGroup>
          {reopenError && <Notice tone="error">{reopenError}</Notice>}
        </Sheet>
      )}
    </Page>
  )
}

export default ReportView
