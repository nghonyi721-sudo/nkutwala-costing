import { formatDate, formatDateTime, formatTime, REPORT_STATUS_LABELS } from '../lib/labels'
import { totalHours } from '../lib/reports'

const SAFETY_ITEMS = [
  ['dsti_done', 'DSTI done'],
  ['internal_audit', 'Internal audit'],
  ['near_miss', 'Near miss'],
  ['safety_moment', 'Safety moment'],
]

// Read-only view of one report (from fetchReport). Used by the site manager
// for submitted reports and by owners for every report. Quantities only.
function ReportSummary({ report }) {
  const crew = report.report_crew ?? []
  const equipment = report.report_equipment ?? []

  return (
    <div className="card summary">
      <p className={`badge ${report.status}`}>{REPORT_STATUS_LABELS[report.status]}</p>
      <h1>{report.project?.name}</h1>
      <p className="summary-line">{formatDate(report.report_date)}</p>
      {report.reporter?.full_name && (
        <p className="summary-line">Site manager: {report.reporter.full_name}</p>
      )}
      {report.submitted_at && (
        <p className="summary-line">Submitted {formatDateTime(report.submitted_at)}</p>
      )}

      {report.reopened_at && (
        <p className="notice">
          Reopened {formatDateTime(report.reopened_at)}
          {report.reopener?.full_name ? ` by ${report.reopener.full_name}` : ''}
          <br />
          Reason: {report.reopen_reason}
        </p>
      )}

      <h2>Times</h2>
      <p className="summary-line">
        {formatTime(report.start_time)} to {formatTime(report.end_time)}
      </p>

      <h2>Crew</h2>
      {crew.length === 0 ? (
        <p>No crew recorded.</p>
      ) : (
        <ul className="list">
          {crew.map((line) => (
            <li key={line.id} className="summary-row">
              <span>{line.employee?.full_name}</span>
              <strong>{Number(line.hours)} h</strong>
            </li>
          ))}
        </ul>
      )}
      <p className="total">Total man-hours: {totalHours(crew)}</p>

      <h2>Equipment</h2>
      {equipment.length === 0 ? (
        <p>No equipment recorded.</p>
      ) : (
        <ul className="list">
          {equipment.map((line) => (
            <li key={line.id} className="summary-row">
              <span>{line.equipment?.name}</span>
              <strong>{Number(line.hours)} h</strong>
            </li>
          ))}
        </ul>
      )}

      <h2>Site conditions</h2>
      <ul className="list">
        <li className="summary-row">
          <span>Fuel</span>
          <strong>{Number(report.fuel_litres)} L</strong>
        </li>
        <li className="summary-row">
          <span>Rain</span>
          <strong>{report.rain_percent}%</strong>
        </li>
        <li className="summary-row">
          <span>Delay</span>
          <strong>{Number(report.delay_hours)} h</strong>
        </li>
      </ul>

      <h2>Safety</h2>
      <ul className="list">
        {SAFETY_ITEMS.map(([key, label]) => (
          <li key={key} className="summary-row">
            <span>{label}</span>
            <strong>{report[key] ? 'Yes' : 'No'}</strong>
          </li>
        ))}
      </ul>

      <h2>Activities</h2>
      <p className="activities">{report.activities || 'None recorded.'}</p>
    </div>
  )
}

export default ReportSummary
