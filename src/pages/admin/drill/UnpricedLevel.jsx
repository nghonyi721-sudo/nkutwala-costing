import { useEffect, useState } from 'react'
import { fetchUnpriced } from '../../../lib/drilldown'
import { formatDate } from '../../../lib/labels'
import { CoinsIcon, UserCheckIcon, WarningIcon } from '../../../components/icons'
import { Row } from '../../../components/Row'
import Section from '../../../components/Section'
import SummaryCard from '../../../components/SummaryCard'
import DrillPage from './DrillPage'
import { LOAD_ERROR, hoursText } from './drillText'
import { reportLevel } from './levels'
import s from './Drill.module.css'

// The hours behind the Unpriced figure: who, and which days. Under each
// person or machine, the way to price them - approve a new person (with
// their rate), or set a rate. The total comes from the database
// (drill_unpriced) and equals the Unpriced figure.
function UnpricedLevel({ level, nav }) {
  const { projectId, period } = level
  const [rows, setRows] = useState(undefined)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    fetchUnpriced(projectId, period)
      .then((result) => {
        if (cancelled) return
        setError('')
        setRows(result)
      })
      .catch(() => {
        if (!cancelled) setError(LOAD_ERROR)
      })
    return () => {
      cancelled = true
    }
  }, [projectId, period, nav.reloadCount])

  // One group per person or machine, in the database's order (no sums).
  const groups = []
  for (const row of rows ?? []) {
    const key = `${row.category}:${row.who_id}`
    let group = groups.find((g) => g.key === key)
    if (!group) {
      group = { key, row, lines: [] }
      groups.push(group)
    }
    group.lines.push(row)
  }

  function action({ row }) {
    if (row.category === 'owned_plant') {
      return { label: 'Set rate', icon: CoinsIcon, next: { kind: 'machine-rates', label: row.name, equipmentId: row.who_id } }
    }
    if (row.employee_status === 'pending') {
      return { label: 'Approve employee', icon: UserCheckIcon, next: { kind: 'approve', label: row.name, employeeId: row.who_id } }
    }
    return { label: 'Set rate', icon: CoinsIcon, next: { kind: 'employee-rates', label: row.name, employeeId: row.who_id } }
  }

  return (
    <DrillPage nav={nav} title="Unpriced hours" period={period} error={error} loading={rows === undefined}>
      <SummaryCard
        icon={WarningIcon}
        label="Not priced yet"
        value={Number(rows?.[0]?.total_hours ?? 0).toFixed(1)}
        unit="h"
      />

      {rows?.length === 0 && (
        <Section>
          <Row title="Every hour in this period has a rate" />
        </Section>
      )}

      {groups.map((group) => {
        const { label, icon, next } = action(group)
        const pending = group.row.employee_status === 'pending'
        return (
          <Section
            key={group.key}
            title={`${group.row.name}${group.row.category === 'owned_plant' ? ' · machine' : ''}${pending ? ' · pending' : ''}`}
          >
            {group.lines.map((line) => (
              <Row
                key={`${line.report_id}:${line.report_date}`}
                title={formatDate(line.report_date)}
                subtitle={line.project_name}
                trailing={hoursText(line.hours)}
                chevron
                onClick={() => nav.open(reportLevel(line.report_id, formatDate(line.report_date)))}
              />
            ))}
            <Row icon={icon} tone="accent" title={label} onClick={() => nav.open(next)} />
          </Section>
        )
      })}

      {rows?.length > 0 && (
        <p className={s.note}>
          New people are priced once you approve them with a rate. Everyone else is priced once they have a
          rate that starts on or before the date. Tap a date to see the report.
        </p>
      )}
    </DrillPage>
  )
}

export default UnpricedLevel
