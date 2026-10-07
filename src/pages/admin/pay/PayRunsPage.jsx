import { useEffect, useState } from 'react'
import { fetchOutstanding, fetchPeriods } from '../../../lib/payRuns'
import { PAY_PERIOD_STATUS_LABELS, PAY_PERIOD_STATUS_TONES, formatDate, formatRand } from '../../../lib/labels'
import Button from '../../../components/Button'
import EmptyState from '../../../components/EmptyState'
import { CoinsIcon, HourglassIcon, PlusIcon } from '../../../components/icons'
import Notice from '../../../components/Notice'
import Page from '../../../components/Page'
import { Row } from '../../../components/Row'
import Section from '../../../components/Section'
import Skeleton from '../../../components/Skeleton'
import StatusBadge from '../../../components/StatusBadge'
import { LOAD_ERROR, hoursText } from '../drill/drillText'
import OutstandingScreen from './OutstandingScreen'
import PayPeriodScreen from './PayPeriodScreen'
import { PeriodSheet } from './PeriodSheets'

// Owner/admin: pay runs. Pay periods (newest first), a new one on the
// suggested dates, and what's still to be paid. Tap a period to close it,
// mark it paid or download its pay run. Every figure comes from the database.
//   role: the user's role (only a system admin reopens a period)
function PayRunsPage({ role }) {
  // undefined = loading, array = loaded
  const [periods, setPeriods] = useState(undefined)
  const [outstanding, setOutstanding] = useState(undefined)
  const [error, setError] = useState('')
  const [reloadCount, setReloadCount] = useState(0)
  // { kind: 'period', id } | { kind: 'outstanding' }
  const [open, setOpen] = useState(null)
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    if (open) return undefined
    let cancelled = false
    Promise.all([fetchPeriods(), fetchOutstanding()])
      .then(([list, owed]) => {
        if (cancelled) return
        setError('')
        setPeriods(list)
        setOutstanding(owed)
      })
      .catch(() => {
        if (!cancelled) setError(LOAD_ERROR)
      })
    return () => {
      cancelled = true
    }
  }, [open, reloadCount])

  if (open?.kind === 'period') return <PayPeriodScreen periodId={open.id} role={role} onBack={() => setOpen(null)} />
  if (open?.kind === 'outstanding') return <OutstandingScreen onBack={() => setOpen(null)} />

  const owed = outstanding?.[0]

  return (
    <Page
      title="Pay runs"
      subtitle="Gross before deductions - not payslips"
      action={
        <Button variant="plain" inline icon={PlusIcon} onClick={() => setAdding(true)}>
          New
        </Button>
      }
    >
      {error && <Notice tone="error">{error}</Notice>}
      {!error && periods === undefined && <Skeleton rows={3} />}

      {outstanding && (
        <Section title="To be paid">
          <Row
            icon={HourglassIcon}
            title="Outstanding"
            subtitle={owed ? `${owed.total_people} people · ${hoursText(owed.total_hours)} not yet paid` : 'Everyone has been paid'}
            trailing={owed ? <span className="num">{formatRand(owed.total_pay)}</span> : undefined}
            chevron
            onClick={() => setOpen({ kind: 'outstanding' })}
          />
        </Section>
      )}

      {periods?.length === 0 && (
        <EmptyState
          icon={CoinsIcon}
          title="No pay periods yet"
          text="Create the first pay period, then close it when the reports are in to save the pay run."
          action={<Button onClick={() => setAdding(true)}>New pay period</Button>}
        />
      )}

      {periods?.length > 0 && (
        <Section title="Pay periods" footer="Newest first. Tap one to close it, mark it paid or download its pay run.">
          {periods.map((period) => (
            <Row
              key={period.id}
              title={`${formatDate(period.start_date)} – ${formatDate(period.end_date)}`}
              subtitle={
                period.run_id
                  ? `${period.people} ${Number(period.people) === 1 ? 'person' : 'people'} · ${formatRand(period.gross ?? 0)} gross${period.paid_on ? ` · paid ${formatDate(period.paid_on)}` : ''}`
                  : 'Not closed yet'
              }
              trailing={
                <StatusBadge
                  status={period.status}
                  label={PAY_PERIOD_STATUS_LABELS[period.status]}
                  tone={PAY_PERIOD_STATUS_TONES[period.status]}
                />
              }
              chevron
              onClick={() => setOpen({ kind: 'period', id: period.id })}
            />
          ))}
        </Section>
      )}

      {adding && (
        <PeriodSheet
          period={null}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false)
            setReloadCount((count) => count + 1)
          }}
        />
      )}
    </Page>
  )
}

export default PayRunsPage
