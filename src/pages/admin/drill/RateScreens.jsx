import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { EMPLOYEE_COLUMNS } from '../../../lib/employeeSteps'
import Notice from '../../../components/Notice'
import Page from '../../../components/Page'
import Skeleton from '../../../components/Skeleton'
import EmployeeForm from '../EmployeeForm'
import EquipmentForm from '../EquipmentForm'
import { LOAD_ERROR } from './drillText'

// From the Unpriced level: open a person's or a machine's own page, where
// their rates are, by id.

function useRecord(table, columns, id) {
  const [record, setRecord] = useState(undefined)
  const [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    supabase
      .from(table)
      .select(columns)
      .eq('id', id)
      .single()
      .then(({ data, error: loadError }) => {
        if (cancelled) return
        if (loadError) setError(LOAD_ERROR)
        else setRecord(data)
      })
    return () => {
      cancelled = true
    }
  }, [table, columns, id])
  return { record, error }
}

function Loading({ title, backLabel, onDone, error }) {
  return (
    <Page title={title} onBack={() => onDone(false)} backLabel={backLabel}>
      {error ? <Notice tone="error">{error}</Notice> : <Skeleton rows={3} />}
    </Page>
  )
}

export function PersonRates({ employeeId, name, backLabel, onDone }) {
  const { record, error } = useRecord('employees', EMPLOYEE_COLUMNS, employeeId)
  if (!record) return <Loading title={name} backLabel={backLabel} onDone={onDone} error={error} />
  return <EmployeeForm employee={record} backLabel={backLabel} onDone={onDone} />
}

export function MachineRates({ equipmentId, name, backLabel, onDone }) {
  const { record, error } = useRecord('equipment', 'id, name, ownership, active', equipmentId)
  if (!record) return <Loading title={name} backLabel={backLabel} onDone={onDone} error={error} />
  return <EquipmentForm machine={record} backLabel={backLabel} onDone={onDone} />
}
