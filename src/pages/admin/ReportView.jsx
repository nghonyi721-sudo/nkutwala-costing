import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { fetchReport } from '../../lib/reports'
import ReportSummary from '../../components/ReportSummary'

// Owner/admin: one report, read-only. A submitted report can be reopened
// (with a reason) so the site manager can correct it. The database keeps
// the submitted version in the audit log.
function ReportView({ reportId, onBack }) {
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
    <div className="card">
      <button type="button" className="btn-secondary btn-back" onClick={onBack}>
        ← Daily reports
      </button>

      {loadError && (
        <p className="error" role="alert">
          {loadError}
        </p>
      )}
      {!loadError && report === undefined && <p className="loading">Loading…</p>}
      {report === null && <p className="error">Report not found.</p>}

      {report && <ReportSummary report={report} />}

      {report?.status === 'draft' && (
        <p className="notice">
          This report is a draft. The site manager can still change it.
        </p>
      )}

      {report?.status === 'submitted' &&
        (reopening ? (
          <div className="confirm">
            <label htmlFor="reopen-reason">Why does this report need to be reopened?</label>
            <input
              id="reopen-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            {reopenError && (
              <p className="error" role="alert">
                {reopenError}
              </p>
            )}
            <button type="button" className="btn-danger" disabled={busy} onClick={reopen}>
              {busy ? 'Reopening…' : 'Confirm reopen'}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setReopening(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              setReopenError('')
              setReopening(true)
            }}
          >
            Reopen report
          </button>
        ))}
    </div>
  )
}

export default ReportView
