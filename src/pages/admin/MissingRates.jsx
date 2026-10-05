import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { formatDate } from '../../lib/labels'
import EmptyState from '../../components/EmptyState'
import { BulldozerIcon, CheckCircleIcon, UserIcon } from '../../components/icons'
import Notice from '../../components/Notice'
import Page from '../../components/Page'
import { Row } from '../../components/Row'
import Section from '../../components/Section'
import Skeleton from '../../components/Skeleton'
import EmployeeForm from './EmployeeForm'
import EquipmentForm from './EquipmentForm'

// One entry per person or machine: all their unpriced hours together.
function groupByWho(lines) {
  const groups = new Map()
  for (const line of lines) {
    const kind = line.employee_id ? 'employee' : 'equipment'
    const id = line.employee_id ?? line.equipment_id
    const key = `${kind}:${id}`
    const group = groups.get(key) ?? { key, kind, id, name: line.name, hours: 0, first: line.report_date, last: line.report_date, projects: new Set() }
    group.hours += Number(line.hours)
    if (line.report_date < group.first) group.first = line.report_date
    if (line.report_date > group.last) group.last = line.report_date
    group.projects.add(line.project_name)
    groups.set(key, group)
  }
  return [...groups.values()].sort((a, b) => b.hours - a.hours)
}

// Owner/admin: hours on submitted reports that have no rate on their date,
// so they are in no cost total. Tap a person or machine to add the rate -
// a rate from the right start date prices those hours automatically.
//   projectId: only this project's hours (otherwise every project)
function MissingRates({ projectId, backLabel, onBack }) {
  // undefined = loading, array = loaded
  const [groups, setGroups] = useState(undefined)
  const [loadError, setLoadError] = useState('')
  const [reloadCount, setReloadCount] = useState(0)
  // The person or machine whose rates are open: { kind, record }
  const [open, setOpen] = useState(null)
  const [openError, setOpenError] = useState('')

  useEffect(() => {
    let cancelled = false

    let query = supabase
      .from('unpriced_hours')
      .select('project_name, report_date, employee_id, equipment_id, name, hours')
      .order('report_date')
    if (projectId) query = query.eq('project_id', projectId)

    query.then(({ data, error }) => {
      if (cancelled) return
      if (error) {
        setLoadError('Could not load the missing rates. Check your signal and try again.')
      } else {
        setLoadError('')
        setGroups(groupByWho(data))
      }
    })

    return () => {
      cancelled = true
    }
  }, [projectId, reloadCount])

  async function openRates(group) {
    setOpenError('')
    const { data, error } =
      group.kind === 'employee'
        ? await supabase.from('employees').select('id, full_name, category, active').eq('id', group.id).single()
        : await supabase.from('equipment').select('id, name, ownership, active').eq('id', group.id).single()
    if (error) {
      setOpenError('Could not open it. Check your signal and try again.')
    } else {
      setOpen({ kind: group.kind, record: data })
    }
  }

  if (open) {
    const done = () => {
      setOpen(null)
      setReloadCount((count) => count + 1)
    }
    return open.kind === 'employee' ? (
      <EmployeeForm employee={open.record} backLabel="Missing rates" onDone={done} />
    ) : (
      <EquipmentForm machine={open.record} backLabel="Missing rates" onDone={done} />
    )
  }

  const totalHours = (groups ?? []).reduce((sum, group) => sum + group.hours, 0)

  return (
    <Page
      title="Missing rates"
      subtitle={groups?.length ? `${totalHours.toFixed(1)} h not priced` : undefined}
      onBack={onBack}
      backLabel={backLabel}
    >
      {loadError && <Notice tone="error">{loadError}</Notice>}
      {openError && <Notice tone="error">{openError}</Notice>}
      {!loadError && groups === undefined && <Skeleton />}

      {groups?.length === 0 && (
        <EmptyState
          icon={CheckCircleIcon}
          title="No missing rates"
          text="Every hour on submitted reports has a rate, so it's all in the totals."
        />
      )}

      {groups?.length > 0 && (
        <Section
          title="Hours with no rate"
          footer="Add a rate that starts on or before the first date shown. Those hours are then priced automatically; old months keep their old rates."
        >
          {groups.map((group) => (
            <Row
              key={group.key}
              icon={group.kind === 'employee' ? UserIcon : BulldozerIcon}
              iconTone="red"
              title={group.name}
              subtitle={
                `${group.hours.toFixed(1)} h · from ${formatDate(group.first)}` +
                (group.last !== group.first ? ` to ${formatDate(group.last)}` : '') +
                (group.projects.size === 1 ? ` · ${[...group.projects][0]}` : ` · ${group.projects.size} projects`)
              }
              mono
              trailing="Add rate"
              chevron
              onClick={() => openRates(group)}
            />
          ))}
        </Section>
      )}
    </Page>
  )
}

export default MissingRates
