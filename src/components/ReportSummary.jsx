import { formatDate, formatDateTime, formatTime } from '../lib/labels'
import { totalHours } from '../lib/reports'
import DataTable from './DataTable'
import Figure from './Figure'
import PageHeader from './PageHeader'
import SectionHeading from './SectionHeading'
import StatusTag from './StatusTag'

const SAFETY_ITEMS = [
  ['dsti_done', 'DSTI done'],
  ['internal_audit', 'Internal audit'],
  ['near_miss', 'Near miss'],
  ['safety_moment', 'Safety moment'],
]

const NAME_HOURS = (nameLabel, nameOf) => [
  { key: 'name', label: nameLabel, render: nameOf },
  { key: 'hours', label: 'Hours', numeric: true, render: (line) => Number(line.hours).toFixed(1) },
]

const LABEL_VALUE = (valueLabel) => [
  { key: 'label', label: 'Item' },
  { key: 'value', label: valueLabel, numeric: true },
]

// Read-only view of one report (from fetchReport). Used by the site manager
// for submitted reports and by owners for every report. Quantities only.
function ReportSummary({ report }) {
  const crew = report.report_crew ?? []
  const equipment = report.report_equipment ?? []

  const conditions = [
    { id: 'start', label: 'Start', value: formatTime(report.start_time) },
    { id: 'end', label: 'End', value: formatTime(report.end_time) },
    { id: 'delay', label: 'Delay (h)', value: Number(report.delay_hours).toFixed(1) },
  ]
  const safety = SAFETY_ITEMS.map(([key, label]) => ({
    id: key,
    label,
    value: report[key] ? 'Yes' : 'No',
  }))

  return (
    <div className="card summary">
      <PageHeader
        eyebrow="Daily activity report"
        title={report.project?.name}
        meta={
          <>
            <span className="num">{formatDate(report.report_date)}</span>
            {report.reporter?.full_name && <> · {report.reporter.full_name}</>}
            {report.submitted_at && (
              <>
                {' '}
                · Submitted <span className="num">{formatDateTime(report.submitted_at)}</span>
              </>
            )}
          </>
        }
      />
      <StatusTag status={report.status} />

      {report.reopened_at && (
        <p className="notice">
          Reopened <span className="num">{formatDateTime(report.reopened_at)}</span>
          {report.reopener?.full_name ? ` by ${report.reopener.full_name}` : ''}
          <br />
          Reason: {report.reopen_reason}
        </p>
      )}

      <div className="figures">
        <Figure label="Man-hours" value={totalHours(crew).toFixed(1)} unit="h" />
        <Figure label="Plant hours" value={totalHours(equipment).toFixed(1)} unit="h" />
        <Figure label="Fuel" value={Number(report.fuel_litres).toFixed(1)} unit="L" />
        <Figure label="Rain" value={report.rain_percent} unit="%" />
      </div>

      <SectionHeading number={1}>Crew</SectionHeading>
      {crew.length === 0 ? (
        <p className="label">No crew recorded.</p>
      ) : (
        <DataTable
          caption="Crew hours"
          columns={NAME_HOURS('Name', (line) => line.employee?.full_name)}
          rows={crew}
        />
      )}

      <SectionHeading number={2}>Equipment</SectionHeading>
      {equipment.length === 0 ? (
        <p className="label">No equipment recorded.</p>
      ) : (
        <DataTable
          caption="Equipment hours"
          columns={NAME_HOURS('Equipment', (line) => line.equipment?.name)}
          rows={equipment}
        />
      )}

      <SectionHeading number={3}>Times &amp; delays</SectionHeading>
      <DataTable caption="Times and delays" columns={LABEL_VALUE('Value')} rows={conditions} />

      <SectionHeading number={4}>Safety</SectionHeading>
      <DataTable caption="Safety checks" columns={LABEL_VALUE('Done')} rows={safety} />

      <SectionHeading number={5}>Activities</SectionHeading>
      <p className="activities">{report.activities || 'None recorded.'}</p>
    </div>
  )
}

export default ReportSummary
