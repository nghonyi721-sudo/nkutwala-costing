import { useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { EMPLOYEE_CATEGORY_LABELS } from '../../lib/labels'
import ChoiceButtons from '../../components/ChoiceButtons'
import EmployeeRates from './EmployeeRates'

const ACTIVE_OPTIONS = { yes: 'Active', no: 'Inactive' }

// Add an employee (employee = null) or edit one. Employees are never deleted:
// mark them Inactive instead. When editing, their rates are shown below.
function EmployeeForm({ employee, onDone }) {
  const [fullName, setFullName] = useState(employee?.full_name ?? '')
  const [category, setCategory] = useState(employee?.category ?? '')
  const [active, setActive] = useState(employee?.active ?? true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

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

  return (
    <div className="card">
      <form className="card" onSubmit={handleSubmit}>
        <h1>{employee ? 'Edit employee' : 'Add employee'}</h1>

        <label htmlFor="full-name">Full name</label>
        <input
          id="full-name"
          required
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />

        <ChoiceButtons
          label="Category"
          options={EMPLOYEE_CATEGORY_LABELS}
          value={category}
          onChange={setCategory}
        />

        <ChoiceButtons
          label="Status"
          options={ACTIVE_OPTIONS}
          value={active ? 'yes' : 'no'}
          onChange={(choice) => setActive(choice === 'yes')}
        />

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save employee'}
        </button>
        <button type="button" className="btn-secondary" onClick={() => onDone(false)}>
          {employee ? 'Back to employees' : 'Cancel'}
        </button>
      </form>

      {employee && <EmployeeRates employeeId={employee.id} />}
    </div>
  )
}

export default EmployeeForm
