import { useEffect, useState } from 'react'
import { fetchHours } from '../../../lib/drilldown'
import { formatRand } from '../../../lib/labels'
import { BulldozerIcon, UsersThreeIcon } from '../../../components/icons'
import { Row } from '../../../components/Row'
import Section from '../../../components/Section'
import StatusBadge from '../../../components/StatusBadge'
import SummaryCard from '../../../components/SummaryCard'
import DrillPage from './DrillPage'
import { LOAD_ERROR, PROVISIONAL_NOTE, daysText, hoursText, overtimeText, ratesText } from './drillText'
import { employeeLevel } from './levels'
import s from './Drill.module.css'

// Labour (per person) or Owned plant (per machine) in a period: hours, days,
// the rate(s) applied and the cost. The total comes from the database
// (drill_hours) and equals the category's figure on the dashboard.
// Tap a person to see their days.
function HoursLevel({ level, nav }) {
  const { projectId, period, category } = level
  const [rows, setRows] = useState(undefined)
  const [error, setError] = useState('')
  const people = category === 'labour'

  useEffect(() => {
    let cancelled = false
    fetchHours(projectId, period, category)
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
  }, [projectId, period, category, nav.reloadCount])

  // Every row carries the level's totals.
  const totals = rows?.[0]

  return (
    <DrillPage nav={nav} title={level.label} period={period} error={error} loading={rows === undefined}>
      <SummaryCard
        icon={people ? UsersThreeIcon : BulldozerIcon}
        label={level.label}
        value={formatRand(totals?.total_cost ?? 0)}
        figures={[
          { label: 'Hours', value: Number(totals?.total_hours ?? 0).toFixed(1), unit: 'h' },
          ...(people
            ? [
                { label: 'Overtime', value: formatRand(totals?.total_ot_pay ?? 0) },
                { label: 'OT hours', value: Number(totals?.total_ot_hours ?? 0).toFixed(1), unit: 'h' },
              ]
            : []),
          { label: 'Unpriced', value: Number(totals?.total_unpriced_hours ?? 0).toFixed(1), unit: 'h' },
        ]}
      />

      <Section
        title={people ? 'Per person' : 'Per machine'}
        footer={people ? `${PROVISIONAL_NOTE} Tap a person to see their days.` : PROVISIONAL_NOTE}
      >
        {rows?.length === 0 && <Row title={people ? 'No crew hours in this period' : 'No plant hours in this period'} />}
        {rows?.map((row) => {
          const unpriced = Number(row.unpriced_hours) > 0
          const badge =
            row.status === 'pending' ? 'Pending' : row.status === 'inactive' ? 'Inactive' : null
          return (
            <Row
              key={row.who_id}
              title={row.name}
              subtitle={
                [
                  `${hoursText(row.hours)} · ${daysText(row.days)}`,
                  row.rates.length > 0 ? ratesText(row.rates) : 'no rate',
                  people ? overtimeText(row.ot_pay, row.ot_hours) : null,
                  unpriced ? `${hoursText(row.unpriced_hours)} unpriced` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')
              }
              trailing={
                badge ? (
                  <span className={s.trailingStack}>
                    <span className="num">{formatRand(row.cost)}</span>
                    <StatusBadge status={row.status} tone={row.status === 'pending' ? 'red' : 'grey'} label={badge} />
                  </span>
                ) : (
                  formatRand(row.cost)
                )
              }
              mono
              chevron={people}
              onClick={people ? () => nav.open(employeeLevel(row.who_id, row.name, projectId, period)) : undefined}
            />
          )
        })}
      </Section>
    </DrillPage>
  )
}

export default HoursLevel
