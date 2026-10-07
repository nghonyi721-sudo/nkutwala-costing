import { useEffect, useState } from 'react'
import { fetchOutstanding } from '../../../lib/payRuns'
import { formatDate, formatRand } from '../../../lib/labels'
import { HourglassIcon } from '../../../components/icons'
import Notice from '../../../components/Notice'
import Page from '../../../components/Page'
import { Row } from '../../../components/Row'
import Section from '../../../components/Section'
import Skeleton from '../../../components/Skeleton'
import SummaryCard from '../../../components/SummaryCard'
import { LOAD_ERROR, daysText, hoursText } from '../drill/drillText'

// The "to be paid" list: per person, the days on submitted reports that no
// active pay run has paid yet - oldest first. Paid days drop off it (they
// stay in history, the dashboard and the exports). Figures from the database.
function OutstandingScreen({ onBack }) {
  const [rows, setRows] = useState(undefined)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    fetchOutstanding()
      .then((data) => {
        if (!cancelled) setRows(data)
      })
      .catch(() => {
        if (!cancelled) setError(LOAD_ERROR)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const totals = rows?.[0] ?? {}

  return (
    <Page title="Outstanding" subtitle="Worked, not yet paid" onBack={onBack} backLabel="Pay runs">
      {error && <Notice tone="error">{error}</Notice>}
      {!error && rows === undefined && <Skeleton rows={4} />}

      {rows && (
        <SummaryCard
          icon={HourglassIcon}
          label="To be paid"
          meta="Before deductions"
          value={formatRand(totals.total_pay ?? 0)}
          figures={[
            { label: 'People', value: String(totals.total_people ?? 0) },
            { label: 'Hours', value: Number(totals.total_hours ?? 0).toFixed(1), unit: 'h' },
            { label: 'Unpriced', value: Number(totals.total_unpriced_hours ?? 0).toFixed(1), unit: 'h' },
          ]}
        />
      )}

      {rows && (
        <Section
          title={`People · ${rows.length}`}
          footer="Unpriced: not approved yet, or no rate on the day - paid once that's fixed. Days in no pay period are paid when a period covers them."
        >
          {rows.length === 0 && <Row title="Everyone has been paid" />}
          {rows.map((row) => {
            const unpriced = Number(row.unpriced_hours) > 0
            return (
              <Row
                key={row.employee_id}
                title={row.employee_name}
                subtitle={[
                  `${daysText(row.days)} · ${hoursText(row.hours)} · since ${formatDate(row.first_day)}`,
                  unpriced ? `${hoursText(row.unpriced_hours)} unpriced${row.employee_status === 'pending' ? ' - pending approval' : ''}` : '',
                  Number(row.days_in_closed) > 0 ? `${daysText(row.days_in_closed)} in a closed period` : '',
                  Number(row.days_without_period) > 0 ? `${daysText(row.days_without_period)} in no pay period` : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
                trailing={<span className="num">{row.pay === null ? 'unpriced' : formatRand(row.pay)}</span>}
              />
            )
          })}
        </Section>
      )}
    </Page>
  )
}

export default OutstandingScreen
