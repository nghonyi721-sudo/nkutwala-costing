import { useEffect, useState } from 'react'
import { createPeriod, fetchGap, fetchNextDates, markPaid, payError, reopenPeriod, updatePeriod } from '../../../lib/payRuns'
import { formatDate, todayLocal } from '../../../lib/labels'
import Button from '../../../components/Button'
import DateTimeField from '../../../components/DateTimeField'
import { CalendarBlankIcon } from '../../../components/icons'
import Notice from '../../../components/Notice'
import { FieldRow, Row } from '../../../components/Row'
import Sheet, { SheetGroup } from '../../../components/Sheet'
import Skeleton from '../../../components/Skeleton'

// The sheets of the pay run screens. Every change goes through the
// database's own checks (8B-1); its refusals are shown as they come back.

// New pay period (period null) or change an open one's dates and notes.
// A new one starts on the suggested dates: 14 days from the day after the
// last period. A gap before it is a warning, never a block.
export function PeriodSheet({ period, onClose, onSaved }) {
  const [form, setForm] = useState(
    period ? { start: period.start_date, end: period.end_date, notes: period.notes ?? '' } : undefined,
  )
  const [gap, setGap] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // A new period: the suggested dates.
  useEffect(() => {
    if (period) return undefined
    let cancelled = false
    fetchNextDates()
      .then((next) => {
        if (!cancelled) setForm({ start: next?.start_date ?? todayLocal(), end: next?.end_date ?? todayLocal(), notes: '' })
      })
      .catch(() => {
        if (!cancelled) setForm({ start: todayLocal(), end: todayLocal(), notes: '' })
      })
    return () => {
      cancelled = true
    }
  }, [period])

  // Days between the period before this one and this one's start.
  const start = form?.start
  useEffect(() => {
    if (!start) return undefined
    let cancelled = false
    fetchGap(start)
      .then((days) => {
        if (!cancelled) setGap(days)
      })
      .catch(() => {
        if (!cancelled) setGap(null)
      })
    return () => {
      cancelled = true
    }
  }, [start])

  async function save() {
    if (!form.start || !form.end) {
      setError('Choose both dates.')
      return
    }
    if (form.end < form.start) {
      setError('The end date must be on or after the start date.')
      return
    }
    setError('')
    setBusy(true)
    try {
      if (period) await updatePeriod(period.id, form)
      else await createPeriod(form)
      onSaved()
    } catch (saveError) {
      setError(payError(saveError))
      setBusy(false)
    }
  }

  return (
    <Sheet
      title={period ? 'Dates and notes' : 'New pay period'}
      hint={period ? undefined : 'Suggested: 14 days from the day after the last pay period. Change the dates if you need to.'}
      cancelLabel="Cancel"
      showDone={false}
      onClose={onClose}
      footer={
        <Button busy={busy} disabled={!form} onClick={save}>
          {busy ? 'Saving…' : period ? 'Save' : 'Create pay period'}
        </Button>
      }
    >
      {!form && <Skeleton rows={2} />}
      {form && (
        <>
          <SheetGroup>
            <Row
              icon={CalendarBlankIcon}
              title="Starts"
              trailing={
                <DateTimeField type="date" label="Starts" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />
              }
            />
            <Row
              icon={CalendarBlankIcon}
              title="Ends"
              trailing={
                <DateTimeField type="date" label="Ends" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} />
              }
            />
          </SheetGroup>
          <SheetGroup>
            <FieldRow
              label="Notes"
              placeholder="Optional"
              inputWidth="62%"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </SheetGroup>
          {Number(gap) > 0 && (
            <Notice tone="info">
              {gap} day{Number(gap) === 1 ? '' : 's'} between the last pay period and this one. Nobody is paid for those
              days until a pay period covers them.
            </Notice>
          )}
        </>
      )}
      {error && <Notice tone="error">{error}</Notice>}
    </Sheet>
  )
}

// Mark a closed period paid, with the date it was paid (today by default).
export function MarkPaidSheet({ period, onClose, onSaved }) {
  const [paidOn, setPaidOn] = useState(todayLocal())
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function save() {
    if (!paidOn) {
      setError('Choose the date it was paid.')
      return
    }
    setError('')
    setBusy(true)
    try {
      await markPaid(period.id, paidOn)
      onSaved()
    } catch (saveError) {
      setError(payError(saveError))
      setBusy(false)
    }
  }

  return (
    <Sheet
      title="Mark paid"
      hint={`${formatDate(period.start_date)} – ${formatDate(period.end_date)}. The pay run stays exactly as it was closed.`}
      cancelLabel="Cancel"
      showDone={false}
      onClose={onClose}
      footer={
        <Button busy={busy} onClick={save}>
          {busy ? 'Saving…' : 'Mark paid'}
        </Button>
      }
    >
      <SheetGroup>
        <Row
          icon={CalendarBlankIcon}
          title="Paid on"
          trailing={
            <DateTimeField type="date" label="Paid on" value={paidOn} max={todayLocal()} onChange={(e) => setPaidOn(e.target.value)} />
          }
        />
      </SheetGroup>
      {error && <Notice tone="error">{error}</Notice>}
    </Sheet>
  )
}

// System admin only: reopen a closed or paid period, with a reason. The
// saved run is kept (superseded); closing again saves the next version.
export function ReopenSheet({ period, onClose, onSaved }) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function save() {
    if (!reason.trim()) {
      setError('Enter a reason for reopening.')
      return
    }
    setError('')
    setBusy(true)
    try {
      await reopenPeriod(period.id, reason.trim())
      onSaved()
    } catch (saveError) {
      setError(payError(saveError))
      setBusy(false)
    }
  }

  return (
    <Sheet
      title="Reopen pay period"
      hint={`Version ${period.version} is kept, marked superseded. Reports in the period can be changed again; closing it again saves version ${Number(period.versions) + 1}.`}
      cancelLabel="Cancel"
      showDone={false}
      onClose={onClose}
      footer={
        <Button variant="danger" busy={busy} onClick={save}>
          {busy ? 'Reopening…' : 'Reopen pay period'}
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
      {error && <Notice tone="error">{error}</Notice>}
    </Sheet>
  )
}
