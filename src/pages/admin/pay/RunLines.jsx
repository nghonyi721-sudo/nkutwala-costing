import { formatRand } from '../../../lib/labels'
import { CoinsIcon } from '../../../components/icons'
import { Row } from '../../../components/Row'
import Section from '../../../components/Section'
import SummaryCard from '../../../components/SummaryCard'
import { daysText, hoursText, overtimeText, ratesText } from '../drill/drillText'

// A pay run's people - the preview before closing, or a saved run. rows come
// from the database (pay_period_preview or pay_run_people) with the totals
// on every row: nothing is added up here.
//   title:  the paid people's section title
//   footer: under that section
function RunLines({ rows, title = 'People paid', footer }) {
  const totals = rows[0] ?? {}
  const paid = rows.filter((row) => row.included)
  const left = rows.filter((row) => !row.included)

  return (
    <>
      <SummaryCard
        icon={CoinsIcon}
        label="Gross pay"
        meta="Before deductions"
        value={formatRand(totals.total_gross ?? 0)}
        figures={[
          { label: 'People', value: String(totals.total_people ?? 0) },
          { label: 'Hours', value: Number(totals.total_hours ?? 0).toFixed(1), unit: 'h' },
          { label: 'Overtime', value: Number(totals.total_ot_hours ?? 0).toFixed(1), unit: 'h' },
          ...(Number(totals.total_late_hours) > 0
            ? [{ label: 'Late', value: Number(totals.total_late_hours).toFixed(1), unit: 'h' }]
            : []),
        ]}
      />

      <Section title={`${title} · ${paid.length}`} footer={footer}>
        {paid.length === 0 && <Row title="Nobody to pay" />}
        {paid.map((row) => (
          <Row
            key={row.employee_id}
            title={row.employee_name}
            subtitle={[
              `${daysText(row.days)} · ${hoursText(row.hours)}`,
              overtimeText(row.ot_pay, row.ot_hours),
              Number(row.late_hours) > 0 ? `${hoursText(row.late_hours)} late (earlier periods)` : '',
              ratesText((row.rates ?? []).map((rate) => rate.rate)),
            ]
              .filter(Boolean)
              .join(' · ')}
            trailing={<span className="num">{formatRand(row.gross)}</span>}
          />
        ))}
      </Section>

      {left.length > 0 && (
        <Section
          title={`Left out - not approved yet · ${left.length}`}
          footer="No rate yet, so not paid in this run. Once approved, their hours are paid in a later run as late hours."
        >
          {left.map((row) => (
            <Row
              key={row.employee_id}
              title={row.employee_name}
              subtitle={`${daysText(row.days)} · ${hoursText(row.hours)}`}
              trailing="unpriced"
            />
          ))}
        </Section>
      )}
    </>
  )
}

export default RunLines
