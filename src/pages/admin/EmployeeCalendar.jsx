import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { fetchEmployeeMonth } from '../../lib/dashboard'
import { formatRand } from '../../lib/labels'
import { CaretLeftIcon, CaretRightIcon, UserIcon } from '../../components/icons'
import Notice from '../../components/Notice'
import { Row } from '../../components/Row'
import { PickSheet } from '../../components/Sheet'
import s from './Dashboard.module.css'

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// The first day of this month in South Africa, "YYYY-MM-01".
function thisMonth() {
  return `${new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' }).slice(0, 7)}-01`
}

// The month before/after, "YYYY-MM-01". (Calendar dates, not money.)
function shiftMonth(month, by) {
  const [year, number] = month.split('-').map(Number)
  const date = new Date(Date.UTC(year, number - 1 + by, 1))
  return date.toISOString().slice(0, 10)
}

function monthLabel(month) {
  const [year, number] = month.split('-').map(Number)
  return new Date(year, number - 1, 1).toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })
}

// The calendar grid: blanks before the 1st (weeks start on Monday), then
// every day of the month as "YYYY-MM-DD".
function monthCells(month) {
  const [year, number] = month.split('-').map(Number)
  const blanks = (new Date(Date.UTC(year, number - 1, 1)).getUTCDay() + 6) % 7
  const days = new Date(Date.UTC(year, number, 0)).getUTCDate()
  const prefix = month.slice(0, 8)
  return [
    ...Array.from({ length: blanks }, () => null),
    ...Array.from({ length: days }, (_, i) => `${prefix}${String(i + 1).padStart(2, '0')}`),
  ]
}

const hoursText = (hours) => Number(hours).toFixed(1)

// Calendar shading: darker blue for longer days (a full day is about 9 h).
// 0 h = marked Absent on the report: no shading.
function heatClass(hours) {
  const value = Number(hours)
  if (value === 0) return ''
  if (value >= 9) return s.heat3
  if (value >= 6) return s.heat2
  return s.heat1
}

// Owner/admin: pick an employee, see their hours per day for a month (from
// SUBMITTED reports) and the month's totals. Tap a day to open its report.
// Every number comes from the database. Sits inside a dashboard card.
//   projectId: only this project's hours (null = all projects)
function EmployeeCalendar({ projectId, onOpenReport }) {
  const [employees, setEmployees] = useState([])
  const [employeeId, setEmployeeId] = useState(null)
  const [month, setMonth] = useState(thisMonth)
  const [monthData, setMonthData] = useState(null) // { key, days, summary }
  const [error, setError] = useState('')
  const [picking, setPicking] = useState(false)
  const [choosingFrom, setChoosingFrom] = useState(null) // a day with several reports

  useEffect(() => {
    supabase
      .from('employees')
      .select('id, full_name, active')
      .order('full_name')
      .then(({ data }) => setEmployees(data ?? []))
  }, [])

  const key = `${employeeId}|${month}|${projectId}`
  useEffect(() => {
    if (!employeeId) return undefined
    let cancelled = false

    fetchEmployeeMonth(employeeId, month, projectId)
      .then((result) => {
        if (cancelled) return
        setError('')
        setMonthData({ key: `${employeeId}|${month}|${projectId}`, ...result })
      })
      .catch(() => {
        if (!cancelled) setError('Could not load the hours. Check your signal and try again.')
      })

    return () => {
      cancelled = true
    }
  }, [employeeId, month, projectId])

  const current = monthData?.key === key ? monthData : null
  const byDay = Object.fromEntries((current?.days ?? []).map((row) => [row.day, row]))
  const employee = employees.find((e) => e.id === employeeId)

  function openDay(day) {
    const row = byDay[day]
    if (!row) return
    if (row.reports.length === 1) onOpenReport(row.reports[0].report_id)
    else setChoosingFrom(row)
  }

  return (
    <>
      <Row
        icon={UserIcon}
        title={employee?.full_name ?? 'Choose an employee'}
        tone={employee ? undefined : 'accent'}
        chevron
        onClick={() => setPicking(true)}
      />

      {employee && (
        <>
          <div className={s.monthBar}>
            <button type="button" className={s.monthButton} aria-label="Previous month" onClick={() => setMonth((m) => shiftMonth(m, -1))}>
              <CaretLeftIcon size={20} weight="bold" />
            </button>
            <span className={s.monthName}>{monthLabel(month)}</span>
            <button type="button" className={s.monthButton} aria-label="Next month" onClick={() => setMonth((m) => shiftMonth(m, 1))}>
              <CaretRightIcon size={20} weight="bold" />
            </button>
          </div>

          {error && <Notice tone="error">{error}</Notice>}

          <div className={s.calendar} role="grid" aria-label={`${employee.full_name}, ${monthLabel(month)}`}>
            {DAY_NAMES.map((name) => (
              <span key={name} className={s.dayName} role="columnheader">
                {name}
              </span>
            ))}
            {monthCells(month).map((day, index) => {
              if (!day) return <span key={`blank-${index}`} aria-hidden="true" />
              const row = byDay[day]
              const dayNumber = Number(day.slice(8))
              return row ? (
                <button
                  key={day}
                  type="button"
                  className={`${s.day} ${s.dayWorked} ${heatClass(row.hours)}`}
                  aria-label={`${dayNumber}: ${Number(row.hours) > 0 ? `${hoursText(row.hours)} hours` : 'absent'} - open the report`}
                  onClick={() => openDay(day)}
                >
                  <span className={s.dayNumber}>{dayNumber}</span>
                  <span className={`${s.dayHours} num`}>{Number(row.hours) > 0 ? hoursText(row.hours) : '–'}</span>
                </button>
              ) : (
                <span key={day} className={s.day}>
                  <span className={s.dayNumber}>{dayNumber}</span>
                </span>
              )
            })}
          </div>

          {current?.summary && (
            <>
              <Row title="Total hours" tone="strong" trailing={`${hoursText(current.summary.total_hours)} h`} />
              <Row
                title="Labour cost"
                subtitle="PROVISIONAL — overtime not applied"
                mono
                trailing={formatRand(current.summary.provisional_cost)}
              />
              {Number(current.summary.unpriced_hours) > 0 && (
                <Row
                  title={`${hoursText(current.summary.unpriced_hours)} h have no rate`}
                  subtitle="They're not in the labour cost above."
                  tone="danger"
                />
              )}
            </>
          )}
        </>
      )}

      {picking && (
        <PickSheet
          title="Employee"
          options={employees.map((e) => ({ value: e.id, title: e.full_name, subtitle: e.active ? undefined : 'Inactive' }))}
          selected={employeeId}
          onPick={setEmployeeId}
          onClose={() => setPicking(false)}
        />
      )}
      {choosingFrom && (
        <PickSheet
          title="Which report?"
          options={choosingFrom.reports.map((report) => ({
            value: report.report_id,
            title: report.project_name,
            subtitle: `${hoursText(report.hours)} h`,
          }))}
          onPick={onOpenReport}
          onClose={() => setChoosingFrom(null)}
        />
      )}
    </>
  )
}

export default EmployeeCalendar
