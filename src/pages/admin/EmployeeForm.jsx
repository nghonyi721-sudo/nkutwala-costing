import { useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { addEmployee, approveEmployee } from '../../lib/employeeSteps'
import { EMPLOYEE_CATEGORY_LABELS, formatDate, localDateOf, todayLocal } from '../../lib/labels'
import ActionBar from '../../components/ActionBar'
import Button from '../../components/Button'
import { PhoneIcon, TagIcon, UserCircleIcon } from '../../components/icons'
import Notice from '../../components/Notice'
import Page from '../../components/Page'
import { FieldRow, Row } from '../../components/Row'
import Section from '../../components/Section'
import SegmentedControl from '../../components/SegmentedControl'
import { PickSheet } from '../../components/Sheet'
import HourlyRates from './HourlyRates'
import RateFields from './RateFields'
import { approvalErrorMessage, rateProblem } from './rateRules'

// Active / Inactive for people already approved (or rejected).
const STATUS_OPTIONS = { approved: 'Active', inactive: 'Inactive' }

// Owner/admin: add an employee (employee = null) or edit one.
// Adding asks for their hourly rate too: saving adds them AND approves them
// with that rate, in one go (nobody is approved without a rate).
// Editing: details, phone, Active/Inactive, and their rates below. Employees
// are never deleted: mark them Inactive instead.
//   backLabel: where Back goes (e.g. "Missing rates" when opened from there)
function EmployeeForm({ employee, onDone, backLabel = 'Employees' }) {
  const [fullName, setFullName] = useState(employee?.full_name ?? '')
  const [category, setCategory] = useState(employee?.category ?? '')
  const [phone, setPhone] = useState(employee?.phone ?? '')
  const [status, setStatus] = useState(employee?.status ?? 'approved')
  const [amount, setAmount] = useState('')
  const [startsOn, setStartsOn] = useState(todayLocal())
  // Saved but not approved yet (approving failed): their id, so trying again
  // only approves - it never adds them twice.
  const [addedId, setAddedId] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [pickingCategory, setPickingCategory] = useState(false)

  function problem() {
    if (!fullName.trim()) return "Enter the employee's full name."
    if (!category) return 'Choose a category.'
    if (phone.trim() && !/^[0-9+() -]{6,20}$/.test(phone.trim())) {
      return 'Enter a phone number with digits only, e.g. 082 123 4567.'
    }
    return employee ? '' : rateProblem(amount, startsOn)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    const found = problem()
    if (found) {
      setError(found)
      return
    }
    setError('')
    setBusy(true)

    if (employee) {
      const values = { full_name: fullName.trim(), category, phone: phone.trim() || null }
      if (employee.status !== 'pending') values.status = status
      const { data, error: saveError } = await supabase
        .from('employees')
        .update(values)
        .eq('id', employee.id)
        .select('id')
      setBusy(false)
      if (saveError?.code === '23514' || saveError?.code === '42501') {
        // The database's own rule, e.g. "Add an hourly rate before approving".
        setError(saveError.message)
      } else if (saveError || data.length === 0) {
        setError('Could not save the employee. Check your signal and try again.')
      } else {
        onDone(true)
      }
      return
    }

    // New: add them (as Pending), then approve them with the rate.
    let personId = addedId
    if (!personId) {
      try {
        personId = (await addEmployee(supabase, { fullName, category, phone })).id
        setAddedId(personId)
      } catch {
        setBusy(false)
        setError('Could not save the employee. Check your signal and try again.')
        return
      }
    }
    try {
      await approveEmployee(supabase, personId, Number(amount), startsOn)
      onDone(true)
    } catch (approveError) {
      setBusy(false)
      setError(`Saved, but not approved yet. ${approvalErrorMessage(approveError, startsOn)} Then tap Save again.`)
    }
  }

  const categoryOptions = Object.entries(EMPLOYEE_CATEGORY_LABELS).map(([value, title]) => ({
    value,
    title,
  }))

  return (
    <Page
      title={employee ? employee.full_name : 'New employee'}
      subtitle={employee ? 'Edit employee and hourly rates' : 'Add a person with their hourly rate'}
      onBack={() => onDone(Boolean(addedId))}
      backLabel={backLabel}
      footer={
        <ActionBar message={error} tone="error">
          <Button variant="secondary" onClick={() => onDone(Boolean(addedId))}>
            Cancel
          </Button>
          {/* Linked to the details form below by its id, so the rates
              section can have its own separate form. */}
          <Button type="submit" form="employee-details" busy={busy}>
            {busy ? 'Saving…' : employee ? 'Save details' : 'Save'}
          </Button>
        </ActionBar>
      }
    >
      {employee?.rejected_at && (
        <Notice tone="info">
          Rejected {formatDate(localDateOf(employee.rejected_at))}: {employee.reject_reason}
        </Notice>
      )}

      <form id="employee-details" onSubmit={handleSubmit}>
        <Section title="Details">
          <FieldRow
            icon={UserCircleIcon}
            label="Full name"
            placeholder="Name and surname"
            required
            disabled={Boolean(addedId)}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
          <Row
            icon={TagIcon}
            title="Category"
            trailing={EMPLOYEE_CATEGORY_LABELS[category] ?? 'Choose'}
            chevron
            onClick={addedId ? undefined : () => setPickingCategory(true)}
          />
          <FieldRow
            icon={PhoneIcon}
            label="Phone"
            type="tel"
            inputMode="tel"
            placeholder="Optional"
            disabled={Boolean(addedId)}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </Section>

        {!employee && (
          <Section
            title="Hourly rate"
            footer="Saving adds them and approves them with this rate. A rate change later is a new rate from a date."
          >
            <RateFields amount={amount} onAmount={setAmount} startsOn={startsOn} onStartsOn={setStartsOn} />
          </Section>
        )}

        {employee && employee.status !== 'pending' && (
          <Section
            title="Status"
            plain
            footer="Employees are never deleted. Mark them Inactive when they leave."
          >
            <SegmentedControl label="Employee status" options={STATUS_OPTIONS} value={status} onChange={setStatus} />
          </Section>
        )}
      </form>

      {employee && <HourlyRates kind="employee" ownerId={employee.id} />}

      {pickingCategory && (
        <PickSheet
          title="Category"
          options={categoryOptions}
          selected={category}
          onPick={setCategory}
          onClose={() => setPickingCategory(false)}
        />
      )}
    </Page>
  )
}

export default EmployeeForm
