import { useEffect, useState } from 'react'
import { closePeriod, fetchBlockers, fetchPeriod, fetchPreview, fetchRunPeople, fetchVersions, payError } from '../../../lib/payRuns'
import { PAY_PERIOD_STATUS_LABELS, formatDate, formatDateTime, formatRand } from '../../../lib/labels'
import ActionBar from '../../../components/ActionBar'
import Button from '../../../components/Button'
import ConfirmSheet from '../../../components/ConfirmSheet'
import {
  ArrowCounterClockwiseIcon,
  CalendarBlankIcon,
  CheckCircleIcon,
  ClipboardTextIcon,
  LockIcon,
  UserIcon,
} from '../../../components/icons'
import Notice from '../../../components/Notice'
import Page from '../../../components/Page'
import { Row } from '../../../components/Row'
import Section from '../../../components/Section'
import Skeleton from '../../../components/Skeleton'
import StatusBadge from '../../../components/StatusBadge'
import ReportView from '../ReportView'
import { PersonRates } from '../drill/RateScreens'
import { LOAD_ERROR, hoursText } from '../drill/drillText'
import { MarkPaidSheet, PeriodSheet, ReopenSheet } from './PeriodSheets'
import RunDownload from './RunDownload'
import RunLines from './RunLines'
import RunScreen from './RunScreen'

const isOpen = (period) => period?.status === 'open' || period?.status === 'reopened'

// One pay period. Open (or reopened): what stops the close, then the
// preview - exactly what closing saves - and Close. Closed: the saved run,
// Mark paid and its Excel. Every version is listed, kept for good. Only a
// system admin reopens. Every figure comes from the database.
//   role: the user's role (system_admin may reopen)
function PayPeriodScreen({ periodId, role, onBack }) {
  const [period, setPeriod] = useState(undefined)
  const [versions, setVersions] = useState([])
  const [blockers, setBlockers] = useState([])
  // The preview (open) or the active run's people (closed / paid).
  const [lines, setLines] = useState(undefined)
  const [loadError, setLoadError] = useState('')
  const [reloadCount, setReloadCount] = useState(0)

  // A screen on top: { kind: 'report' | 'person' | 'version', ... }
  const [open, setOpen] = useState(null)
  // 'edit' | 'paid' | 'reopen' | 'close'
  const [sheet, setSheet] = useState(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      const [found, runs] = await Promise.all([fetchPeriod(periodId), fetchVersions(periodId)])
      let blocking = []
      let rows
      if (isOpen(found)) {
        ;[blocking, rows] = await Promise.all([fetchBlockers(periodId), fetchPreview(periodId)])
      } else if (found?.run_id) {
        rows = await fetchRunPeople(found.run_id)
      }
      return { found, runs, blocking, rows }
    }
    load()
      .then(({ found, runs, blocking, rows }) => {
        if (cancelled) return
        setLoadError('')
        setPeriod(found)
        setVersions(runs)
        setBlockers(blocking)
        setLines(rows)
      })
      .catch(() => {
        if (!cancelled) setLoadError(LOAD_ERROR)
      })
    return () => {
      cancelled = true
    }
  }, [periodId, reloadCount])

  function reload() {
    setSheet(null)
    setActionError('')
    setReloadCount((count) => count + 1)
  }

  async function close() {
    setBusy(true)
    setActionError('')
    try {
      await closePeriod(periodId)
      setBusy(false)
      reload()
    } catch (error) {
      setBusy(false)
      setSheet(null)
      setActionError(payError(error))
    }
  }

  // --- Screens on top ------------------------------------------------------------
  if (open?.kind === 'report') {
    return <ReportView reportId={open.reportId} onBack={() => setOpen(null)} backLabel="Pay period" readOnly />
  }
  if (open?.kind === 'person') {
    return (
      <PersonRates
        employeeId={open.id}
        name={open.name}
        backLabel="Pay period"
        onDone={(changed) => {
          setOpen(null)
          if (changed) reload()
        }}
      />
    )
  }
  if (open?.kind === 'version') {
    return <RunScreen period={period} run={open.run} onBack={() => setOpen(null)} />
  }

  const title = period ? `${formatDate(period.start_date)} – ${formatDate(period.end_date)}` : 'Pay period'
  const activeRun = versions.find((run) => run.status === 'active')
  const totals = lines?.[0] ?? {}
  const canClose = isOpen(period) && lines !== undefined && blockers.length === 0

  let footer
  if (isOpen(period)) {
    footer = (
      <ActionBar message={actionError} tone="error">
        <Button icon={LockIcon} disabled={!canClose} onClick={() => setSheet('close')}>
          Close pay period
        </Button>
      </ActionBar>
    )
  } else if (period?.status === 'closed') {
    footer = (
      <ActionBar message={actionError} tone="error">
        <Button icon={CheckCircleIcon} onClick={() => setSheet('paid')}>
          Mark paid
        </Button>
      </ActionBar>
    )
  }

  return (
    <Page
      title={title}
      subtitle={period ? PAY_PERIOD_STATUS_LABELS[period.status] : undefined}
      onBack={onBack}
      backLabel="Pay runs"
      footer={footer}
    >
      {loadError && <Notice tone="error">{loadError}</Notice>}
      {!loadError && period === undefined && <Skeleton rows={4} />}
      {period === null && <Notice tone="error">Pay period not found.</Notice>}

      {/* Where the period stands */}
      {period?.status === 'paid' && (
        <Notice tone="success">
          Paid on {formatDate(period.paid_on)}
          {period.paid_by_name ? ` (marked by ${period.paid_by_name})` : ''}. Reports, rates and pay rules for these days are locked.
        </Notice>
      )}
      {period?.status === 'closed' && (
        <Notice tone="locked">
          Closed {formatDateTime(period.closed_at)}
          {period.closed_by_name ? ` by ${period.closed_by_name}` : ''} - not paid yet. Reports, rates and pay rules for these days are locked.
        </Notice>
      )}
      {period?.status === 'reopened' && (
        <Notice tone="error">
          Reopened {formatDateTime(period.reopened_at)}
          {period.reopened_by_name ? ` by ${period.reopened_by_name}` : ''}: {period.reopen_reason}. Close it again to save
          version {Number(period.versions) + 1}.
        </Notice>
      )}

      {/* Open: what stops the close, the dates, the preview */}
      {isOpen(period) && blockers.length > 0 && (
        <Section
          title={`Stopping the close · ${blockers.length}`}
          footer="Fix these, then close. People not approved yet don't stop it - they're left out and paid later."
        >
          {blockers.map((blocker, index) =>
            blocker.kind === 'draft_report' ? (
              <Row
                key={`${blocker.kind}-${index}`}
                icon={ClipboardTextIcon}
                iconTone="red"
                title={`Draft report · ${blocker.project_name}`}
                subtitle={`${formatDate(blocker.report_date)} · ask ${blocker.person_name ?? 'the site manager'} to submit it`}
                chevron
                onClick={() => setOpen({ kind: 'report', reportId: blocker.report_id })}
              />
            ) : (
              <Row
                key={`${blocker.kind}-${index}`}
                icon={UserIcon}
                iconTone="red"
                title={blocker.person_name}
                subtitle={`${hoursText(blocker.hours)} on ${formatDate(blocker.report_date)} (${blocker.project_name}) - no rate on that day. Tap to add it.`}
                chevron
                onClick={() => setOpen({ kind: 'person', id: blocker.person_id, name: blocker.person_name })}
              />
            ),
          )}
        </Section>
      )}
      {isOpen(period) && lines !== undefined && blockers.length === 0 && (
        <Notice tone="success">Nothing is stopping the close.</Notice>
      )}
      {isOpen(period) && (
        <Section>
          <Row
            icon={CalendarBlankIcon}
            title="Dates and notes"
            subtitle={period.notes || 'No notes'}
            chevron
            onClick={() => setSheet('edit')}
          />
        </Section>
      )}

      {lines && (
        <RunLines
          rows={lines}
          title={isOpen(period) ? 'Preview - closing saves exactly this' : 'People paid'}
          footer={
            isOpen(period)
              ? 'Gross before deductions - not a payslip. Late hours: days from earlier closed periods not paid until now.'
              : 'Exactly as saved when the period was closed. Gross before deductions - not a payslip.'
          }
        />
      )}

      {/* Closed or paid: the active run's Excel */}
      {!isOpen(period) && period && activeRun && <RunDownload period={period} run={activeRun} />}

      {/* Every version, kept for good */}
      {versions.length > 0 && (
        <Section title="Versions" footer="Every closed version is kept. Reopening marks the saved one superseded.">
          {versions.map((run) => (
            <Row
              key={run.run_id}
              title={`Version ${run.version}`}
              subtitle={
                run.status === 'active'
                  ? `Closed ${formatDateTime(run.closed_at)}${run.closed_by_name ? ` by ${run.closed_by_name}` : ''}${run.paid_on ? ` · paid ${formatDate(run.paid_on)}` : ''}`
                  : `Superseded ${formatDateTime(run.superseded_at)}: ${run.superseded_reason}`
              }
              trailing={
                <StatusBadge
                  status={run.status === 'active' ? 'active' : 'voided'}
                  label={run.status === 'active' ? formatRand(run.gross ?? 0) : 'Superseded'}
                />
              }
              chevron
              onClick={() => setOpen({ kind: 'version', run })}
            />
          ))}
        </Section>
      )}

      {/* System admin only */}
      {role === 'system_admin' && (period?.status === 'closed' || period?.status === 'paid') && (
        <Section footer="System admin only, with a reason. The saved version is kept as superseded.">
          <Row icon={ArrowCounterClockwiseIcon} title="Reopen pay period" tone="danger" onClick={() => setSheet('reopen')} />
        </Section>
      )}

      {sheet === 'close' && (
        <ConfirmSheet
          title="Close this pay period?"
          message={`Saves the pay run: ${totals.total_people ?? 0} people, ${formatRand(totals.total_gross ?? 0)} gross. Reports, rates and pay rules for these days are then locked.`}
          actionLabel="Close pay period"
          busy={busy}
          onConfirm={close}
          onCancel={() => setSheet(null)}
        />
      )}
      {sheet === 'edit' && <PeriodSheet period={period} onClose={() => setSheet(null)} onSaved={reload} />}
      {sheet === 'paid' && <MarkPaidSheet period={period} onClose={() => setSheet(null)} onSaved={reload} />}
      {sheet === 'reopen' && <ReopenSheet period={period} onClose={() => setSheet(null)} onSaved={reload} />}
    </Page>
  )
}

export default PayPeriodScreen
