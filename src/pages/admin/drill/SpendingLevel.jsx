import { useEffect, useState } from 'react'
import { fetchSpending } from '../../../lib/drilldown'
import { formatRand } from '../../../lib/labels'
import { CoinsIcon, WarningIcon } from '../../../components/icons'
import { Row } from '../../../components/Row'
import Section from '../../../components/Section'
import StatusBadge from '../../../components/StatusBadge'
import SummaryCard from '../../../components/SummaryCard'
import { WeeklyMixChart } from '../DashboardCharts'
import DrillPage from './DrillPage'
import { LOAD_ERROR, PROVISIONAL_NOTE, daysText, hoursText } from './drillText'
import { categoryLevel, employeeLevel, unpricedLevel } from './levels'
import s from './Drill.module.css'

// A project (or all projects) in a period: what was spent, by category, per
// week, and the crew with their hours and provisional labour cost. The total
// is the dashboard's own figure (dashboard_summary) for the same period.
function SpendingLevel({ level, nav }) {
  const { projectId, period } = level
  const [data, setData] = useState(undefined)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    fetchSpending(projectId, period)
      .then((result) => {
        if (cancelled) return
        setError('')
        setData(result)
      })
      .catch(() => {
        if (!cancelled) setError(LOAD_ERROR)
      })
    return () => {
      cancelled = true
    }
  }, [projectId, period, nav.reloadCount])

  const summary = data?.summary
  const categories = (data?.categories ?? []).filter((row) => Number(row.spent_in_range) !== 0)
  const unpriced = Number(summary?.unpriced_hours ?? 0) > 0

  return (
    <DrillPage nav={nav} title={level.label} period={period} error={error} loading={data === undefined}>
      <SummaryCard
        icon={CoinsIcon}
        label="Spent"
        value={formatRand(summary?.spent ?? 0)}
        figures={[{ label: 'Unpriced', value: Number(summary?.unpriced_hours ?? 0).toFixed(1), unit: 'h' }]}
      />

      <Section title="By category" footer="Tap a category to see what's behind it. Receipts are VAT inclusive.">
        {categories.length === 0 && <Row title="Nothing spent in this period" />}
        {categories.map((row) => (
          <Row
            key={row.category}
            title={row.label}
            trailing={formatRand(row.spent_in_range)}
            mono
            chevron
            onClick={() => nav.open(categoryLevel(row.category, row.label, projectId, period))}
          />
        ))}
        {unpriced && (
          <Row
            icon={WarningIcon}
            iconTone="red"
            title="Unpriced hours"
            subtitle="Not in the total until they have a rate"
            trailing={hoursText(summary.unpriced_hours)}
            chevron
            onClick={() => nav.open(unpricedLevel(projectId, period))}
          />
        )}
      </Section>

      {data?.weeks.length > 1 && (
        <Section title="Per week" plain>
          <div className={s.chartCard}>
            <WeeklyMixChart weeks={data.weeks} />
          </div>
        </Section>
      )}

      {data?.crew.length > 0 && (
        <Section title="Crew · provisional labour cost" footer={PROVISIONAL_NOTE}>
          {data.crew.map((person) => (
            <Row
              key={person.who_id}
              title={person.name}
              subtitle={
                `${hoursText(person.hours)} · ${daysText(person.days)}` +
                (Number(person.unpriced_hours) > 0 ? ` · ${hoursText(person.unpriced_hours)} unpriced` : '')
              }
              trailing={
                person.status === 'pending' ? (
                  <span className={s.trailingStack}>
                    <span className="num">{formatRand(person.cost)}</span>
                    <StatusBadge status="pending" label="Pending" />
                  </span>
                ) : (
                  formatRand(person.cost)
                )
              }
              mono
              chevron
              onClick={() => nav.open(employeeLevel(person.who_id, person.name, projectId, period))}
            />
          ))}
        </Section>
      )}
    </DrillPage>
  )
}

export default SpendingLevel
