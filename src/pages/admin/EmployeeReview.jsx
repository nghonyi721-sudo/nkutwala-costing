import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { approveEmployee, rejectEmployee, updateEmployeeDetails } from '../../lib/employeeSteps'
import { EMPLOYEE_CATEGORY_LABELS, formatDate, formatDateTime, todayLocal } from '../../lib/labels'
import Button from '../../components/Button'
import {
  ClockIcon,
  NotePencilIcon,
  PhoneIcon,
  TagIcon,
  UserCircleIcon,
} from '../../components/icons'
import Notice from '../../components/Notice'
import Page from '../../components/Page'
import PersonSheet from '../../components/PersonSheet'
import { FieldRow, Row } from '../../components/Row'
import Section from '../../components/Section'
import Sheet, { SheetGroup } from '../../components/Sheet'
import Skeleton from '../../components/Skeleton'
import RateFields from './RateFields'
import { approvalErrorMessage, rateProblem } from './rateRules'

// Owner/admin: one new employee a site manager added. Approve them with an
// hourly rate (one step - never without a rate), or reject them with a
// reason. Until then their hours are unpriced.
//   employeeId: the pending person
//   onDone(changed): back to the list
function EmployeeReview({ employeeId, backLabel = 'Employees', onDone }) {
  // undefined = loading, null = no longer waiting, object = loaded
  const [person, setPerson] = useState(undefined)
  const [loadError, setLoadError] = useState('')
  const [reloadCount, setReloadCount] = useState(0)

  const [amount, setAmount] = useState('')
  const [startsOn, setStartsOn] = useState('')
  const [approving, setApproving] = useState(false)
  const [approveError, setApproveError] = useState('')

  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const [rejectBusy, setRejectBusy] = useState(false)
  const [rejectError, setRejectError] = useState('')

  const [editing, setEditing] = useState(false)
  const [editBusy, setEditBusy] = useState(false)
  const [editError, setEditError] = useState('')

  useEffect(() => {
    let cancelled = false

    supabase
      .from('pending_employees')
      .select('id, full_name, category, phone, created_at, added_by_name, hours_logged, first_worked')
      .eq('id', employeeId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          setLoadError('Could not load this person. Check your signal and try again.')
          return
        }
        setLoadError('')
        setPerson(data)
        // The rate starts on their first day, so the hours they've already
        // worked get priced.
        if (data) setStartsOn((current) => current || data.first_worked || todayLocal())
      })

    return () => {
      cancelled = true
    }
  }, [employeeId, reloadCount])

  async function approve(event) {
    event.preventDefault()
    const problem = rateProblem(amount, startsOn)
    if (problem) {
      setApproveError(problem)
      return
    }
    setApproveError('')
    setApproving(true)
    try {
      await approveEmployee(supabase, employeeId, Number(amount), startsOn)
      onDone(true)
    } catch (error) {
      setApproveError(approvalErrorMessage(error, startsOn))
      setApproving(false)
    }
  }

  async function reject() {
    if (!reason.trim()) {
      setRejectError('Enter a reason for rejecting them.')
      return
    }
    setRejectError('')
    setRejectBusy(true)
    try {
      await rejectEmployee(supabase, employeeId, reason)
      onDone(true)
    } catch (error) {
      setRejectError(error.message?.startsWith('This person') ? error.message : 'Could not reject. Check your signal and try again.')
      setRejectBusy(false)
    }
  }

  async function saveDetails(details) {
    setEditError('')
    setEditBusy(true)
    try {
      await updateEmployeeDetails(supabase, employeeId, details)
      setEditing(false)
      setReloadCount((count) => count + 1)
    } catch {
      setEditError('Could not save. Check your signal and try again.')
    }
    setEditBusy(false)
  }

  const title = person?.full_name ?? 'New employee'
  const pageProps = { title, onBack: () => onDone(false), backLabel }

  if (loadError) {
    return (
      <Page {...pageProps}>
        <Notice tone="error">{loadError}</Notice>
      </Page>
    )
  }
  if (person === undefined) {
    return (
      <Page {...pageProps}>
        <Skeleton rows={4} />
      </Page>
    )
  }
  if (person === null) {
    return (
      <Page {...pageProps}>
        <Notice tone="info">This person is no longer waiting for approval.</Notice>
      </Page>
    )
  }

  const hours = Number(person.hours_logged)

  return (
    <Page {...pageProps} subtitle="New employee · waiting for approval">
      <Section title="Details">
        <Row icon={TagIcon} title="Category" trailing={EMPLOYEE_CATEGORY_LABELS[person.category]} />
        <Row icon={PhoneIcon} title="Phone" trailing={person.phone || 'Not given'} />
        <Row
          icon={UserCircleIcon}
          title="Added by"
          subtitle={formatDateTime(person.created_at)}
          trailing={person.added_by_name ?? 'Unknown'}
        />
        <Row
          icon={ClockIcon}
          iconTone={hours > 0 ? 'red' : undefined}
          title="Hours worked"
          subtitle={
            person.first_worked
              ? `On submitted reports, from ${formatDate(person.first_worked)} · unpriced until approved`
              : 'None on submitted reports yet'
          }
          trailing={`${hours.toFixed(1)} h`}
        />
        <Row
          icon={NotePencilIcon}
          tone="accent"
          title="Edit details"
          onClick={() => {
            setEditError('')
            setEditing(true)
          }}
        />
      </Section>

      <form onSubmit={approve}>
        <Section
          title="Approve"
          footer="Approving saves this rate and approves them in one step. Hours they've worked from the start date are then priced."
        >
          <RateFields amount={amount} onAmount={setAmount} startsOn={startsOn} onStartsOn={setStartsOn} />
        </Section>
        {approveError && <Notice tone="error">{approveError}</Notice>}
        <Section plain>
          <Button type="submit" busy={approving}>
            {approving ? 'Approving…' : 'Approve'}
          </Button>
        </Section>
      </form>

      <Section plain footer="Rejected people are taken off the pick lists and their hours stay unpriced. The reason is kept.">
        <Button
          variant="secondary"
          onClick={() => {
            setRejectError('')
            setRejecting(true)
          }}
        >
          Reject…
        </Button>
      </Section>

      {rejecting && (
        <Sheet
          title="Reject"
          hint={`Reject ${person.full_name}? They become inactive and the reason is kept.`}
          cancelLabel="Cancel"
          showDone={false}
          onClose={() => setRejecting(false)}
          footer={
            <Button variant="danger" busy={rejectBusy} onClick={reject}>
              {rejectBusy ? 'Rejecting…' : 'Reject'}
            </Button>
          }
        >
          <SheetGroup>
            <FieldRow
              label="Reason"
              placeholder="e.g. Duplicate of Sipho Dlamini"
              inputWidth="62%"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </SheetGroup>
          {rejectError && <Notice tone="error">{rejectError}</Notice>}
        </Sheet>
      )}

      {editing && (
        <PersonSheet
          person={person}
          busy={editBusy}
          error={editError}
          onSave={saveDetails}
          onClose={() => setEditing(false)}
        />
      )}
    </Page>
  )
}

export default EmployeeReview
