import { useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { EMPLOYEE_CATEGORY_LABELS } from '../../lib/labels'
import ActionBar from '../../components/ActionBar'
import Button from '../../components/Button'
import { CheckCircleIcon, TagIcon, UserCircleIcon } from '../../components/icons'
import Page from '../../components/Page'
import { FieldRow, Row, SwitchRow } from '../../components/Row'
import Section from '../../components/Section'
import { PickSheet } from '../../components/Sheet'
import EmployeeRates from './EmployeeRates'

// Add an employee (employee = null) or edit one. Employees are never deleted:
// mark them Inactive instead. When editing, their rates are shown below.
function EmployeeForm({ employee, onDone }) {
  const [fullName, setFullName] = useState(employee?.full_name ?? '')
  const [category, setCategory] = useState(employee?.category ?? '')
  const [active, setActive] = useState(employee?.active ?? true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [pickingCategory, setPickingCategory] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    const values = { full_name: fullName.trim(), category, active }
    if (!values.full_name) {
      setError("Enter the employee's full name.")
      return
    }
    if (!values.category) {
      setError('Choose a category.')
      return
    }

    setError('')
    setBusy(true)
    const { data, error: saveError } = employee
      ? await supabase.from('employees').update(values).eq('id', employee.id).select('id')
      : await supabase.from('employees').insert(values).select('id')
    setBusy(false)

    if (saveError || data.length === 0) {
      setError('Could not save the employee. Check your signal and try again.')
    } else {
      onDone(true)
    }
  }

  const categoryOptions = Object.entries(EMPLOYEE_CATEGORY_LABELS).map(([value, title]) => ({
    value,
    title,
  }))

  return (
    <Page
      title={employee ? employee.full_name : 'New employee'}
      subtitle={employee ? 'Edit employee and hourly rates' : 'Add a person'}
      onBack={() => onDone(false)}
      backLabel="Employees"
      footer={
        <ActionBar message={error} tone="error">
          <Button variant="secondary" onClick={() => onDone(false)}>
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
      <form id="employee-details" onSubmit={handleSubmit}>
        <Section title="Details">
          <FieldRow
            icon={UserCircleIcon}
            label="Full name"
            placeholder="Name and surname"
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
          <Row
            icon={TagIcon}
            title="Category"
            trailing={EMPLOYEE_CATEGORY_LABELS[category] ?? 'Choose'}
            chevron
            onClick={() => setPickingCategory(true)}
          />
        </Section>

        <Section footer="Employees are never deleted. Switch them off when they leave.">
          <SwitchRow icon={CheckCircleIcon} title="Active" checked={active} onChange={setActive} />
        </Section>
      </form>

      {employee && <EmployeeRates employeeId={employee.id} />}

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
