import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { EMPLOYEE_CATEGORY_LABELS } from '../../lib/labels'
import Button from '../../components/Button'
import EmptyState from '../../components/EmptyState'
import { PlusIcon, UsersThreeIcon } from '../../components/icons'
import Notice from '../../components/Notice'
import Page from '../../components/Page'
import { Row } from '../../components/Row'
import Section from '../../components/Section'
import Skeleton from '../../components/Skeleton'
import StatusBadge from '../../components/StatusBadge'
import EmployeeForm from './EmployeeForm'

// Owner/admin: list of employees. Tap one to edit it and manage rates.
function EmployeesPage() {
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
    <Page
      title="Employees"
      subtitle={
        employees
          ? `${employees.filter((e) => e.active).length} active of ${employees.length}`
          : undefined
      }
      action={
        <Button variant="plain" inline icon={PlusIcon} onClick={() => setEditing('new')}>
          Add
        </Button>
      }
    >
      {error && <Notice tone="error">{error}</Notice>}

      {!error && employees === undefined && <Skeleton />}

      {employees?.length === 0 && (
        <EmptyState
          icon={UsersThreeIcon}
          title="No employees yet"
          text="Add the people who work on site, then give each one an hourly rate."
          action={<Button onClick={() => setEditing('new')}>Add employee</Button>}
        />
      )}

      {employees?.length > 0 && (
        <Section footer="Tap a person to edit them or manage their hourly rates.">
          {employees.map((employee) => (
            <Row
              key={employee.id}
              title={employee.full_name}
              subtitle={EMPLOYEE_CATEGORY_LABELS[employee.category]}
              trailing={employee.active ? null : <StatusBadge status="inactive" label="Inactive" />}
              chevron
              onClick={() => setEditing(employee)}
            />
          ))}
        </Section>
      )}
    </Page>
  )
}

export default EmployeesPage
