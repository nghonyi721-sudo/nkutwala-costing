import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { formatDate, hoursBetween, todayLocal } from '../../lib/labels'
import { fetchReport, totalHours } from '../../lib/reports'
import ChoiceButtons from '../../components/ChoiceButtons'
import Stepper from '../../components/Stepper'
import ReportSummary from '../../components/ReportSummary'

const SAFETY_ITEMS = [
  ['dsti_done', 'DSTI done'],
  ['internal_audit', 'Internal audit'],
  ['near_miss', 'Near miss'],
  ['safety_moment', 'Safety moment'],
]

const EMPTY_FORM = {
  project_id: '',
  report_date: '',
  start_time: '',
  end_time: '',
  rain_percent: 0,
  delay_hours: 0,
  fuel_litres: '',
  dsti_done: false,
  internal_audit: false,
  near_miss: false,
  safety_moment: false,
  activities: '',
}

function saveErrorMessage(error) {
  if (error.code === '23505') {
    return 'You already have a report for this project and date. Open it from My reports.'
  }
  if (error.code === '42501') {
    return 'This report can no longer be changed - it may have been submitted. Go back to My reports.'
  }
  if (error.code === '23514') {
    return 'A number is out of range. Hours must be more than 0 and at most 24; fuel cannot be negative.'
  }
  return 'Could not save. Check your signal and tap Save again - your entries are still here.'
}

// The Daily Activity Report for site managers. Quantities only.
// reportId = null starts a new report.
function ReportForm({ user, reportId, onDone }) {
  const [id, setId] = useState(reportId)
  // The full report once it's submitted (shown read-only).
  const [submittedReport, setSubmittedReport] = useState(null)

  const [projects, setProjects] = useState([])
  const [employees, setEmployees] = useState([])
  const [machines, setMachines] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const [form, setForm] = useState(() => ({ ...EMPTY_FORM, report_date: todayLocal() }))
  const [crew, setCrew] = useState([]) // [{ employee_id, hours }]
  const [equipmentLines, setEquipmentLines] = useState([]) // [{ equipment_id, hours }]
  const [showCrewPicker, setShowCrewPicker] = useState(false)
  const [showEquipmentPicker, setShowEquipmentPicker] = useState(false)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [confirming, setConfirming] = useState(false)

  function applyReport(report) {
    if (report.status === 'submitted') {
      setSubmittedReport(report)
      return
    }
    setId(report.id)
    setForm({
      project_id: report.project_id,
      report_date: report.report_date,
      start_time: report.start_time ? report.start_time.slice(0, 5) : '',
      end_time: report.end_time ? report.end_time.slice(0, 5) : '',
      rain_percent: report.rain_percent,
      delay_hours: Number(report.delay_hours),
      fuel_litres: Number(report.fuel_litres) ? String(Number(report.fuel_litres)) : '',
      dsti_done: report.dsti_done,
      internal_audit: report.internal_audit,
      near_miss: report.near_miss,
      safety_moment: report.safety_moment,
      activities: report.activities,
    })
    setCrew(
      report.report_crew.map((line) => ({
        employee_id: line.employee_id,
        hours: Number(line.hours),
      })),
    )
    setEquipmentLines(
      report.report_equipment.map((line) => ({
        equipment_id: line.equipment_id,
        hours: Number(line.hours),
      })),
    )
  }

  // Load the pick lists (and the report, if opening an existing one).
  useEffect(() => {
    let cancelled = false

    Promise.all([
      supabase.from('projects').select('id, name, status').order('name'),
      supabase.from('employees').select('id, full_name, active').order('full_name'),
      supabase.from('equipment').select('id, name, active').order('name'),
      reportId ? fetchReport(reportId) : Promise.resolve({ data: null, error: null }),
    ]).then(([projectsResult, employeesResult, equipmentResult, reportResult]) => {
      if (cancelled) return
      const failed = [projectsResult, employeesResult, equipmentResult, reportResult].some(
        (result) => result.error,
      )
      if (failed || (reportId && !reportResult.data)) {
        setLoadError('Could not load the report. Check your signal and try again.')
      } else {
        setProjects(projectsResult.data)
        setEmployees(employeesResult.data)
        setMachines(equipmentResult.data)
        if (reportResult.data) applyReport(reportResult.data)
      }
      setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [reportId])

  // New report: if this manager already has one for the chosen project and
  // day, open it instead of starting a duplicate.
  useEffect(() => {
    if (id || loading || !form.project_id || !form.report_date) return
    let cancelled = false

    supabase
      .from('daily_reports')
      .select('id')
      .eq('project_id', form.project_id)
      .eq('report_date', form.report_date)
      .eq('reporter_id', user.id)
      .maybeSingle()
      .then(async ({ data }) => {
        if (cancelled || !data) return
        const { data: report } = await fetchReport(data.id)
        if (cancelled || !report) return
        applyReport(report)
        setMessage('You already have a report for this project and day, so it has been opened.')
      })

    return () => {
      cancelled = true
    }
  }, [id, loading, form.project_id, form.report_date, user.id])

  function setField(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
    setMessage('')
  }

  const defaultHours = Math.min(24, hoursBetween(form.start_time, form.end_time) ?? 8)

  function addCrew(employeeId) {
    setCrew((current) => [...current, { employee_id: employeeId, hours: defaultHours }])
    setShowCrewPicker(false)
    setMessage('')
  }

  function setCrewHours(employeeId, hours) {
    setCrew((current) =>
      current.map((line) => (line.employee_id === employeeId ? { ...line, hours } : line)),
    )
    setMessage('')
  }

  function removeCrew(employeeId) {
    setCrew((current) => current.filter((line) => line.employee_id !== employeeId))
    setMessage('')
  }

  function addEquipment(equipmentId) {
    setEquipmentLines((current) => [...current, { equipment_id: equipmentId, hours: defaultHours }])
    setShowEquipmentPicker(false)
    setMessage('')
  }

  function setEquipmentHours(equipmentId, hours) {
    setEquipmentLines((current) =>
      current.map((line) => (line.equipment_id === equipmentId ? { ...line, hours } : line)),
    )
    setMessage('')
  }

  function removeEquipment(equipmentId) {
    setEquipmentLines((current) => current.filter((line) => line.equipment_id !== equipmentId))
    setMessage('')
  }

  // Saves everything in one all-or-nothing step. Returns the report id, or
  // null if it failed.
  async function save() {
    if (!form.project_id) {
      setError('Choose a project.')
      return null
    }
    if (!form.report_date) {
      setError('Choose the date.')
      return null
    }
    const fuel = form.fuel_litres === '' ? 0 : Number(form.fuel_litres)
    if (!(fuel >= 0)) {
      setError('Fuel must be 0 or more litres.')
      return null
    }

    setError('')
    setMessage('')
    setBusy(true)
    const { data, error: saveError } = await supabase.rpc('save_report_draft', {
      p_report: { ...form, id, fuel_litres: fuel },
      p_crew: crew,
      p_equipment: equipmentLines,
    })
    setBusy(false)

    if (saveError) {
      setError(saveErrorMessage(saveError))
      return null
    }
    setId(data)
    setMessage(
      `Draft saved at ${new Date().toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}.`,
    )
    return data
  }

  async function submit() {
    const savedId = await save()
    if (!savedId) {
      setConfirming(false)
      return
    }

    setBusy(true)
    const { data, error: submitError } = await supabase
      .from('daily_reports')
      .update({ status: 'submitted' })
      .eq('id', savedId)
      .eq('status', 'draft')
      .select('id')
    if (submitError || data.length === 0) {
      setBusy(false)
      setConfirming(false)
      setError('Saved as a draft, but could not submit. Check your signal and try again.')
      return
    }

    const { data: report } = await fetchReport(savedId)
    setBusy(false)
    setConfirming(false)
    if (report) applyReport(report)
  }

  // --- Rendering -------------------------------------------------------------
  const backButton = (
    <button type="button" className="btn-secondary btn-back" onClick={onDone}>
      ← My reports
    </button>
  )

  if (loading) {
    return (
      <div className="card">
        {backButton}
        <p className="loading">Loading…</p>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="card">
        {backButton}
        <p className="error" role="alert">
          {loadError}
        </p>
      </div>
    )
  }

  if (submittedReport) {
    return (
      <div className="card">
        {backButton}
        <p className="notice">This report has been submitted and can no longer be changed.</p>
        <ReportSummary report={submittedReport} />
      </div>
    )
  }

  // Show active items, plus anything already on this report.
  const projectOptions = Object.fromEntries(
    projects
      .filter((p) => p.status === 'active' || p.id === form.project_id)
      .map((p) => [p.id, p.name]),
  )
  const employeeName = Object.fromEntries(employees.map((e) => [e.id, e.full_name]))
  const machineName = Object.fromEntries(machines.map((m) => [m.id, m.name]))
  const availableEmployees = employees.filter(
    (e) => e.active && !crew.some((line) => line.employee_id === e.id),
  )
  const availableMachines = machines.filter(
    (m) => m.active && !equipmentLines.some((line) => line.equipment_id === m.id),
  )
  const projectName = projectOptions[form.project_id] ?? 'this project'

  return (
    <div className="card report-form">
      {backButton}
      <h1>{id ? 'Daily report (draft)' : 'New daily report'}</h1>

      {/* 1. Project and date */}
      {Object.keys(projectOptions).length === 0 ? (
        <p className="error">There are no active projects. Ask the owner to add one.</p>
      ) : (
        <ChoiceButtons
          label="Project"
          options={projectOptions}
          value={form.project_id}
          onChange={(value) => setField('project_id', value)}
        />
      )}

      <label htmlFor="report-date">Date</label>
      <input
        id="report-date"
        type="date"
        value={form.report_date}
        onChange={(e) => setField('report_date', e.target.value)}
      />

      {/* 2. Times */}
      <div className="two-columns">
        <div className="card">
          <label htmlFor="start-time">Start</label>
          <input
            id="start-time"
            type="time"
            value={form.start_time}
            onChange={(e) => setField('start_time', e.target.value)}
          />
        </div>
        <div className="card">
          <label htmlFor="end-time">End</label>
          <input
            id="end-time"
            type="time"
            value={form.end_time}
            onChange={(e) => setField('end_time', e.target.value)}
          />
        </div>
      </div>

      {/* 3. Crew */}
      <h2>Crew</h2>
      {crew.length === 0 && <p>No one added yet.</p>}
      <ul className="list">
        {crew.map((line) => (
          <li key={line.employee_id} className="line-row">
            <span className="list-title">{employeeName[line.employee_id] ?? 'Unknown'}</span>
            <Stepper
              label="Hours"
              value={line.hours}
              min={0.5}
              unit="h"
              onChange={(hours) => setCrewHours(line.employee_id, hours)}
            />
            <button
              type="button"
              className="btn-secondary btn-remove"
              onClick={() => removeCrew(line.employee_id)}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>

      {showCrewPicker ? (
        <div className="picker">
          <p className="label">Tap a person to add them:</p>
          {availableEmployees.length === 0 && <p>Everyone is already on the report.</p>}
          {availableEmployees.map((employee) => (
            <button
              key={employee.id}
              type="button"
              className="list-item"
              onClick={() => addCrew(employee.id)}
            >
              + {employee.full_name}
            </button>
          ))}
          <button type="button" className="btn-secondary" onClick={() => setShowCrewPicker(false)}>
            Close list
          </button>
        </div>
      ) : (
        <button type="button" className="btn-secondary" onClick={() => setShowCrewPicker(true)}>
          + Add person
        </button>
      )}

      {/* 4. Total man-hours */}
      <p className="total">Total man-hours: {totalHours(crew)}</p>

      {/* 5. Equipment */}
      <h2>Equipment</h2>
      {equipmentLines.length === 0 && <p>No equipment added yet.</p>}
      <ul className="list">
        {equipmentLines.map((line) => (
          <li key={line.equipment_id} className="line-row">
            <span className="list-title">{machineName[line.equipment_id] ?? 'Unknown'}</span>
            <Stepper
              label="Hours"
              value={line.hours}
              min={0.5}
              unit="h"
              onChange={(hours) => setEquipmentHours(line.equipment_id, hours)}
            />
            <button
              type="button"
              className="btn-secondary btn-remove"
              onClick={() => removeEquipment(line.equipment_id)}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>

      {showEquipmentPicker ? (
        <div className="picker">
          <p className="label">Tap a machine to add it:</p>
          {availableMachines.length === 0 && <p>All equipment is already on the report.</p>}
          {availableMachines.map((machine) => (
            <button
              key={machine.id}
              type="button"
              className="list-item"
              onClick={() => addEquipment(machine.id)}
            >
              + {machine.name}
            </button>
          ))}
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setShowEquipmentPicker(false)}
          >
            Close list
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="btn-secondary"
          onClick={() => setShowEquipmentPicker(true)}
        >
          + Add equipment
        </button>
      )}

      {/* 6. Site conditions */}
      <h2>Site conditions</h2>
      <label htmlFor="fuel">Fuel (litres)</label>
      <input
        id="fuel"
        type="number"
        inputMode="decimal"
        min="0"
        step="0.1"
        value={form.fuel_litres}
        onChange={(e) => setField('fuel_litres', e.target.value)}
      />
      <Stepper
        label="Rain"
        value={form.rain_percent}
        step={10}
        max={100}
        unit="%"
        onChange={(value) => setField('rain_percent', value)}
      />
      <Stepper
        label="Delay"
        value={form.delay_hours}
        unit="h"
        onChange={(value) => setField('delay_hours', value)}
      />

      {/* 7. Safety */}
      <h2>Safety</h2>
      <div className="choice-grid">
        {SAFETY_ITEMS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            className="choice toggle"
            aria-pressed={form[key]}
            onClick={() => setField(key, !form[key])}
          >
            {label}
            <span className="toggle-state">{form[key] ? 'Yes ✓' : 'No'}</span>
          </button>
        ))}
      </div>

      {/* 8. Activities */}
      <label htmlFor="activities">Activities</label>
      <textarea
        id="activities"
        rows={5}
        value={form.activities}
        onChange={(e) => setField('activities', e.target.value)}
      />

      {/* 9. Save / submit */}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="success" role="status">
          {message}
        </p>
      )}

      {confirming ? (
        <div className="confirm">
          <p>
            Submit report for <strong>{projectName}</strong>, {formatDate(form.report_date)}?
            You can't change it after this.
          </p>
          <button type="button" className="btn-primary" disabled={busy} onClick={submit}>
            {busy ? 'Submitting…' : 'Yes, submit'}
          </button>
          <button type="button" className="btn-secondary" onClick={() => setConfirming(false)}>
            Go back
          </button>
        </div>
      ) : (
        <>
          <button type="button" className="btn-secondary" disabled={busy} onClick={save}>
            {busy ? 'Saving…' : 'Save draft'}
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={busy}
            onClick={() => {
              setError('')
              setConfirming(true)
            }}
          >
            Submit report
          </button>
        </>
      )}
    </div>
  )
}

export default ReportForm
