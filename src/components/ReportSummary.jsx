import { formatDate, formatDateTime, formatTime } from '../lib/labels'
import { totalHours } from '../lib/reports'
import DataTable from './DataTable'
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

// Read-only view of one report (from fetchReport). Used by the site manager
// for submitted reports and by owners for every report. Quantities only.
function ReportSummary({ report }) {
  const crew = report.report_crew ?? []
  const equipment = report.report_equipment ?? []

  const conditions = [
    { id: 'times', label: 'Times', value: `${formatTime(report.start_time)} - ${formatTime(report.end_time)}` },
    { id: 'fuel', label: 'Fuel (L)', value: Number(report.fuel_litres).toFixed(1) },
    { id: 'rain', label: 'Rain (%)', value: report.rain_percent },
    { id: 'delay', label: 'Delay (h)', value: Number(report.delay_hours).toFixed(1) },
  ]
  const safety = SAFETY_ITEMS.map(([key, label]) => ({
    id: key,
    label,
    value: report[key] ? 'Yes' : 'No',
  }))
  const labelValue = (valueLabel) => [
    { key: 'label', label: 'Item' },
    { key: 'value', label: valueLabel, numeric: true },
  ]

  return (
    <div className="card summary">
      <StatusTag status={report.status} />
      <h1>{report.project?.name}</h1>
      <p className="summary-line">
        <span className="num">{formatDate(report.report_date)}</span>
        {report.reporter?.full_name && <> · {report.reporter.full_name}</>}
      </p>
      {report.submitted_at && (
        <p className="summary-line">
          Submitted <span className="num">{formatDateTime(report.submitted_at)}</span>
        </p>
      )}

      {report.reopened_at && (
        <p className="notice">
          Reopened <span className="num">{formatDateTime(report.reopened_at)}</span>
          {report.reopener?.full_name ? ` by ${report.reopener.full_name}` : ''}
          <br />
          Reason: {report.reopen_reason}
        </p>
      )}

      <h2 className="section">Crew</h2>
      {crew.length === 0 ? (
        <p className="label">No crew recorded.</p>
      ) : (
        <DataTable
          caption="Crew hours"
          columns={NAME_HOURS('Name', (line) => line.employee?.full_name)}
          rows={crew}
        />
      )}
      <p className="total">
        <span>Total man-hours</span>
        <span className="num">{totalHours(crew).toFixed(1)}</span>
      </p>

      <h2 className="section">Equipment</h2>
      {equipment.length === 0 ? (
        <p className="label">No equipment recorded.</p>
      ) : (
        <DataTable
          caption="Equipment hours"
          columns={NAME_HOURS('Equipment', (line) => line.equipment?.name)}
          rows={equipment}
        />
      )}

      <h2 className="section">Site conditions</h2>
      <DataTable caption="Site conditions" columns={labelValue('Value')} rows={conditions} />

      <h2 className="section">Safety</h2>
      <DataTable caption="Safety checks" columns={labelValue('Done')} rows={safety} />

      <h2 className="section">Activities</h2>
      <p className="activities">{report.activities || 'None recorded.'}</p>
    </div>
  )
}

export default ReportSummary
