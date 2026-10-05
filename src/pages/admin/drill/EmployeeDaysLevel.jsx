import { useEffect, useState } from 'react'
import { fetchEmployeeDays } from '../../../lib/drilldown'
import { formatDate, formatRand } from '../../../lib/labels'
import { UserIcon } from '../../../components/icons'
import { Row } from '../../../components/Row'
import Section from '../../../components/Section'
import { PickSheet } from '../../../components/Sheet'
import SummaryCard from '../../../components/SummaryCard'
import DrillPage from './DrillPage'
import { LOAD_ERROR, PROVISIONAL_NOTE, hoursText } from './drillText'
import { reportLevel } from './levels'
import s from './Drill.module.css'

// One person's days in the period: hours, project(s), the rate in effect
// that day and the day's cost. The totals come from the database
// (drill_employee_days) and equal the person's figure one level up. Tap a
// day to see its report (read-only).
function EmployeeDaysLevel({ level, nav }) {
  const { employeeId, projectId, period } = level
  const [rows, setRows] = useState(undefined)
  const [error, setError] = useState('')
  const [pickingReport, setPickingReport] = useState(null) // a day with several reports

  useEffect(() => {
    let cancelled = false
    fetchEmployeeDays(employeeId, projectId, period)
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
  }, [employeeId, projectId, period, nav.reloadCount])

  // Every row carries the level's totals.
  const totals = rows?.[0]

  function openDay(row) {
    if (row.reports.length === 1) {
      nav.open(reportLevel(row.reports[0].report_id, formatDate(row.day)))
    } else {
      setPickingReport(row)
    }
  }

  return (
    <DrillPage nav={nav} title={level.label} period={period} error={error} loading={rows === undefined}>
      <SummaryCard
        icon={UserIcon}
        label="Labour"
        value={formatRand(totals?.total_cost ?? 0)}
        figures={[
          { label: 'Hours', value: Number(totals?.total_hours ?? 0).toFixed(1), unit: 'h' },
          { label: 'Unpriced', value: Number(totals?.total_unpriced_hours ?? 0).toFixed(1), unit: 'h' },
        ]}
      />

      <Section title="Day by day" footer={`${PROVISIONAL_NOTE} Tap a day to see the report.`}>
        {rows?.length === 0 && <Row title="No hours in this period" />}
        {rows?.map((row) => {
          const unpriced = Number(row.unpriced_hours) > 0
          return (
            <Row
              key={row.day}
              title={formatDate(row.day)}
              subtitle={`${row.projects} · ${row.rate === null ? 'no rate - unpriced' : `${formatRand(row.rate)}/h`}`}
              trailing={
                <span className={s.trailingStack}>
                  <span className="num">{hoursText(row.hours)}</span>
                  <span className={unpriced ? `${s.smallFigure} ${s.unpriced} num` : `${s.smallFigure} num`}>
                    {unpriced ? 'unpriced' : formatRand(row.cost)}
                  </span>
                </span>
              }
              chevron
              onClick={() => openDay(row)}
            />
          )
        })}
      </Section>

      {pickingReport && (
        <PickSheet
          title={formatDate(pickingReport.day)}
          hint="Worked on more than one project that day. Pick a report."
          options={pickingReport.reports.map((report) => ({
            value: report.report_id,
            title: report.project_name,
            subtitle: hoursText(report.hours),
          }))}
          onPick={(reportId) => nav.open(reportLevel(reportId, formatDate(pickingReport.day)))}
          onClose={() => setPickingReport(null)}
        />
      )}
    </DrillPage>
  )
}

export default EmployeeDaysLevel
