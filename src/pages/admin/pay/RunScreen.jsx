import { useEffect, useState } from 'react'
import { fetchRunPeople } from '../../../lib/payRuns'
import { formatDate, formatDateTime } from '../../../lib/labels'
import Notice from '../../../components/Notice'
import Page from '../../../components/Page'
import Skeleton from '../../../components/Skeleton'
import { LOAD_ERROR } from '../drill/drillText'
import RunDownload from './RunDownload'
import RunLines from './RunLines'

// One saved version of a pay period, exactly as it was closed (the snapshot
// never changes), with its Excel. A superseded version says so - nobody
// should pay from it.
//   period: { id, start_date, end_date }; run: a row of pay_run_versions
function RunScreen({ period, run, onBack }) {
  const [rows, setRows] = useState(undefined)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    fetchRunPeople(run.run_id)
      .then((data) => {
        if (!cancelled) setRows(data)
      })
      .catch(() => {
        if (!cancelled) setError(LOAD_ERROR)
      })
    return () => {
      cancelled = true
    }
  }, [run.run_id])

  return (
    <Page
      title={`Version ${run.version}`}
      subtitle={`${formatDate(period.start_date)} – ${formatDate(period.end_date)}`}
      onBack={onBack}
      backLabel="Pay period"
    >
      {run.status === 'superseded' ? (
        <Notice tone="error">
          Superseded {formatDateTime(run.superseded_at)}
          {run.superseded_by_name ? ` by ${run.superseded_by_name}` : ''}: {run.superseded_reason}. Do not pay from this version.
        </Notice>
      ) : (
        <Notice tone="info">
          Closed {formatDateTime(run.closed_at)}
          {run.closed_by_name ? ` by ${run.closed_by_name}` : ''}
          {run.paid_on ? ` · paid ${formatDate(run.paid_on)}` : ' · not paid yet'}.
        </Notice>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      {!error && rows === undefined && <Skeleton rows={4} />}
      {rows && <RunLines rows={rows} footer="Exactly as saved when this version was closed." />}
      <RunDownload period={period} run={run} />
    </Page>
  )
}

export default RunScreen
