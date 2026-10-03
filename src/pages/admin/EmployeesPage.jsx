import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { EMPLOYEE_CATEGORY_LABELS } from '../../lib/labels'
import EmployeeForm from './EmployeeForm'

// Owner/admin: list of employees. Tap one to edit it and manage rates.
function EmployeesPage({ onBack }) {
  // undefined = loading, array = loaded
  const [employees, setEmployees] = useState(undefined)
  const [error, setError] = useState('')
  // null = show the list, 'new' = add form, an employee = edit form
  const [editing, setEditing] = useState(null)
  const [reloadCount, setReloadCount] = useState(0)

  useEffect(() => {
    let cancelled = false

    supabase
      .from('employees')
      .select('id, full_name, category, active')
      .order('full_name')
      .then(({ data, error: loadError }) => {
        if (cancelled) return
        if (loadError) {
          setError('Could not load employees. Check your signal and try again.')
        } else {
          setError('')
          setEmployees(data)
        }
      })

    return () => {
      cancelled = true
    }
  }, [reloadCount])

  if (editing) {
    return (
      <EmployeeForm
        employee={editing === 'new' ? null : editing}
        onDone={(saved) => {
          setEditing(null)
          if (saved) setReloadCount((count) => count + 1)
        }}
      />
    )
  }

  return (
    <div className="card">
      <button type="button" className="btn-secondary btn-back" onClick={onBack}>
        ← Back
      </button>
      <h1>Employees</h1>

      <button type="button" className="btn-primary" onClick={() => setEditing('new')}>
        + Add employee
      </button>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {!error && employees === undefined && <p className="loading">Loading…</p>}

      {employees?.length === 0 && <p>No employees yet.</p>}

      {employees?.length > 0 && (
        <ul className="list">
          {employees.map((employee) => (
            <li key={employee.id}>
              <button
                type="button"
                className={`list-item${employee.active ? '' : ' inactive'}`}
                onClick={() => setEditing(employee)}
              >
                <span className="list-title">{employee.full_name}</span>
                <span className="list-detail">
                  {EMPLOYEE_CATEGORY_LABELS[employee.category]}
                  {employee.active ? '' : ' · Inactive'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default EmployeesPage
