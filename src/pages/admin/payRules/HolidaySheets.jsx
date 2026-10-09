import { useState } from 'react'
import { addHoliday, ruleError, voidHoliday } from '../../../lib/payRules'
import { formatDate, todayLocal } from '../../../lib/labels'
import Button from '../../../components/Button'
import DateTimeField from '../../../components/DateTimeField'
import { CalendarBlankIcon } from '../../../components/icons'
import Notice from '../../../components/Notice'
import { FieldRow, Row } from '../../../components/Row'
import Sheet, { SheetGroup } from '../../../components/Sheet'

// Add a public holiday: a date and a name.
export function AddHolidaySheet({ onClose, onSaved }) {
  const [date, setDate] = useState(todayLocal())
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function save() {
    if (!date || !name.trim()) {
      setError('Choose the date and enter the holiday\'s name.')
      return
    }
    setError('')
    setBusy(true)
    try {
      await addHoliday({ date, name })
      onSaved()
    } catch (saveError) {
      setError(ruleError(saveError, { kind: 'holiday', date }))
      setBusy(false)
    }
  }

  return (
    <Sheet
      title="Add public holiday"
      hint="Paid at the public holiday rate only while that rule is on."
      cancelLabel="Cancel"
      showDone={false}
      onClose={onClose}
      footer={
        <Button busy={busy} onClick={save}>
          {busy ? 'Saving…' : 'Add holiday'}
        </Button>
      }
    >
      <SheetGroup>
        <Row
          icon={CalendarBlankIcon}
          title="Date"
          trailing={<DateTimeField type="date" label="Date" value={date} onChange={(e) => setDate(e.target.value)} />}
        />
        <FieldRow label="Name" placeholder="e.g. Heritage Day" inputWidth="62%" value={name} onChange={(e) => setName(e.target.value)} />
      </SheetGroup>
      {error && <Notice tone="error">{error}</Notice>}
    </Sheet>
  )
}

// Void a public holiday, with a reason (it stays in the list, crossed out).
export function VoidHolidaySheet({ holiday, onClose, onSaved }) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function save() {
    if (!reason.trim()) {
      setError('Enter a reason for voiding this holiday.')
      return
    }
    setError('')
    setBusy(true)
    try {
      await voidHoliday(holiday.id, reason.trim())
      onSaved()
    } catch (saveError) {
      setError(ruleError(saveError, { kind: 'holiday' }))
      setBusy(false)
    }
  }

  return (
    <Sheet
      title={holiday.name}
      hint={`${formatDate(holiday.holiday_date)}. Voiding keeps it in the list, marked Voided. A holiday on a day already in a closed or paid pay run can't be voided.`}
      cancelLabel="Cancel"
      showDone={false}
      onClose={onClose}
      footer={
        <Button variant="danger" busy={busy} onClick={save}>
          {busy ? 'Voiding…' : 'Void holiday'}
        </Button>
      }
    >
      <SheetGroup>
        <FieldRow label="Reason" placeholder="Why is it wrong?" inputWidth="62%" value={reason} onChange={(e) => setReason(e.target.value)} />
      </SheetGroup>
      {error && <Notice tone="error">{error}</Notice>}
    </Sheet>
  )
}
