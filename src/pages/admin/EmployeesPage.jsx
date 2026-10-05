import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { EMPLOYEE_COLUMNS } from '../../lib/employeeSteps'
import { EMPLOYEE_CATEGORY_LABELS } from '../../lib/labels'
import Button from '../../components/Button'
import EmptyState from '../../components/EmptyState'
import { PlusIcon, UserCheckIcon, UsersThreeIcon } from '../../components/icons'
import Notice from '../../components/Notice'
import Page from '../../components/Page'
import { Row } from '../../components/Row'
import Section from '../../components/Section'
import Skeleton from '../../components/Skeleton'
import StatusBadge from '../../components/StatusBadge'
import EmployeeForm from './EmployeeForm'
import EmployeeReview from './EmployeeReview'

// Owner/admin: everyone, in three lists - new people waiting for approval
// (added by site managers), active people, and inactive or rejected people.
//   onChanged: called after someone is approved, rejected or saved
function EmployeesPage({ onChanged }) {
  // undefined = loading, array = loaded
  const [employees, setEmployees] = useState(undefined)
  // Who added each new person and their hours, by id (owner-only view).
  const [waiting, setWaiting] = useState({})
  const [error, setError] = useState('')
  // null = the lists, 'new' = add form, an employee = edit form
  const [editing, setEditing] = useState(null)
  // The id of the new person being approved or rejected
  const [reviewing, setReviewing] = useState(null)
  const [reloadCount, setReloadCount] = useState(0)

  useEffect(() => {
    let cancelled = false

    Promise.all([
      supabase.from('employees').select(EMPLOYEE_COLUMNS).order('full_name'),
      supabase.from('pending_employees').select('id, added_by_name, hours_logged'),
    ]).then(([employeesResult, waitingResult]) => {
      if (cancelled) return
      if (employeesResult.error || waitingResult.error) {
        setError('Could not load employees. Check your signal and try again.')
      } else {
        setError('')
        setEmployees(employeesResult.data)
        setWaiting(Object.fromEntries(waitingResult.data.map((row) => [row.id, row])))
      }
    })

    return () => {
      cancelled = true
    }
  }, [reloadCount])

  function done(changed) {
    setEditing(null)
    setReviewing(null)
    if (changed) {
      setReloadCount((count) => count + 1)
      onChanged?.()
    }
  }

  if (reviewing) return <EmployeeReview employeeId={reviewing} onDone={done} />
  if (editing) return <EmployeeForm employee={editing === 'new' ? null : editing} onDone={done} />

  const pending = (employees ?? []).filter((e) => e.status === 'pending')
  const active = (employees ?? []).filter((e) => e.status === 'approved')
  const inactive = (employees ?? []).filter((e) => e.status === 'inactive')

  return (
    <Page
      title="Employees"
      subtitle={
        employees
          ? `${active.length} active${pending.length > 0 ? ` · ${pending.length} waiting for approval` : ''}`
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
          text="Add the people who work on site, each with an hourly rate."
          action={<Button onClick={() => setEditing('new')}>Add employee</Button>}
        />
      )}

      {pending.length > 0 && (
        <Section
          title={`New employees · ${pending.length}`}
          footer="Added by site managers, with the hours they've worked. Their hours stay unpriced until you approve them with a rate."
        >
          {pending.map((employee) => {
            const info = waiting[employee.id]
            const hours = Number(info?.hours_logged ?? 0)
            return (
              <Row
                key={employee.id}
                icon={UserCheckIcon}
                iconTone="red"
                title={employee.full_name}
                subtitle={`${EMPLOYEE_CATEGORY_LABELS[employee.category]} · by ${info?.added_by_name ?? 'unknown'} · ${hours.toFixed(1)} h`}
                trailing={<StatusBadge status="alert" label="Approve" />}
                chevron
                onClick={() => setReviewing(employee.id)}
              />
            )
          })}
        </Section>
      )}

      {active.length > 0 && (
        <Section title="Active" footer="Tap a person to edit them or manage their hourly rates.">
          {active.map((employee) => (
            <Row
              key={employee.id}
              title={employee.full_name}
              subtitle={EMPLOYEE_CATEGORY_LABELS[employee.category]}
              chevron
              onClick={() => setEditing(employee)}
            />
          ))}
        </Section>
      )}

      {inactive.length > 0 && (
        <Section title="Inactive" footer="Employees are never deleted. Rejected people stay here with the reason.">
          {inactive.map((employee) => (
            <Row
              key={employee.id}
              title={employee.full_name}
              subtitle={
                employee.rejected_at
                  ? `Rejected · ${employee.reject_reason}`
                  : EMPLOYEE_CATEGORY_LABELS[employee.category]
              }
              trailing={
                <StatusBadge status="inactive" label={employee.rejected_at ? 'Rejected' : 'Inactive'} />
              }
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
