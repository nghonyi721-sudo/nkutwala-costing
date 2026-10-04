import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { formatDate, hoursBetween, todayLocal } from '../../lib/labels'
import { fetchReport, totalHours } from '../../lib/reports'
import ActionBar from '../../components/ActionBar'
import Button from '../../components/Button'
import {
  CalendarBlankIcon,
  ClipboardTextIcon,
  ClockIcon,
  CloudRainIcon,
  GasPumpIcon,
  HardHatIcon,
  HourglassIcon,
  ListChecksIcon,
  MapPinIcon,
  MinusCircleIcon,
  PlusIcon,
  WarningIcon,
} from '../../components/icons'
import HeroCard from '../../components/HeroCard'
import Notice from '../../components/Notice'
import Page from '../../components/Page'
import ReportSummary from '../../components/ReportSummary'
import { FieldRow, Row, SwitchRow } from '../../components/Row'
import Section from '../../components/Section'
import { PickSheet } from '../../components/Sheet'
import Skeleton from '../../components/Skeleton'
import Stepper from '../../components/Stepper'
import TextAreaGroup from '../../components/TextAreaGroup'
import s from './ReportForm.module.css'

const SAFETY_ITEMS = [
  ['dsti_done', 'DSTI done'],
  ['internal_audit', 'Internal audit'],
  ['near_miss', 'Near miss'],
  ['safety_moment', 'Safety moment'],
]

const SAFETY_ICONS = {
  dsti_done: ListChecksIcon,
  internal_audit: ClipboardTextIcon,
  near_miss: WarningIcon,
  safety_moment: HardHatIcon,
}

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
  const [pickingProject, setPickingProject] = useState(false)
  const [editingList, setEditingList] = useState(null) // 'crew' | 'equipment' | null

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
  const pageTitle = id ? 'Daily report' : 'New daily report'

  if (loading) {
    return (
      <Page title={pageTitle} onBack={onDone} backLabel="My reports">
        <Skeleton rows={4} />
      </Page>
    )
  }

  if (loadError) {
    return (
      <Page title={pageTitle} onBack={onDone} backLabel="My reports">
        <Notice tone="error">{loadError}</Notice>
      </Page>
    )
  }

  if (submittedReport) {
    return (
      <Page
        title={submittedReport.project?.name ?? 'Daily report'}
        subtitle={formatDate(submittedReport.report_date)}
        onBack={onDone}
        backLabel="My reports"
      >
        <Notice tone="locked">Submitted and locked. Only the owner can reopen it.</Notice>
        <ReportSummary report={submittedReport} />
      </Page>
    )
  }

  // Show active items, plus anything already on this report.
  const projectChoices = projects.filter((p) => p.status === 'active' || p.id === form.project_id)
  const projectName = projectChoices.find((p) => p.id === form.project_id)?.name
  const employeeName = Object.fromEntries(employees.map((e) => [e.id, e.full_name]))
  const machineName = Object.fromEntries(machines.map((m) => [m.id, m.name]))
  const availableEmployees = employees.filter(
    (e) => e.active && !crew.some((line) => line.employee_id === e.id),
  )
  const availableMachines = machines.filter(
    (m) => m.active && !equipmentLines.some((line) => line.equipment_id === m.id),
  )
  const siteHours = hoursBetween(form.start_time, form.end_time)
  const dateText = form.report_date ? formatDate(form.report_date) : 'No date'
  const toggleEditing = (list) => setEditingList((current) => (current === list ? null : list))

  const removeButton = (label, onRemove) => (
    <button type="button" className={s.remove} aria-label={label} onClick={onRemove}>
      <MinusCircleIcon size={28} weight="fill" />
    </button>
  )

  const footer = (
    <ActionBar
      message={
        confirming
          ? `Submit the report for ${projectName ?? 'this project'}, ${dateText}? You can't change it after this.`
          : error || message
      }
      tone={error && !confirming ? 'error' : 'info'}
    >
      {confirming ? (
        <>
          <Button variant="secondary" onClick={() => setConfirming(false)}>
            Go back
          </Button>
          <Button busy={busy} onClick={submit}>
            {busy ? 'Submitting…' : 'Yes, submit'}
          </Button>
        </>
      ) : (
        <>
          <Button variant="secondary" busy={busy} onClick={save}>
            {busy ? 'Saving…' : 'Save draft'}
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              setError('')
              setConfirming(true)
            }}
          >
            Submit
          </Button>
        </>
      )}
    </ActionBar>
  )

  return (
    <Page
      title={pageTitle}
      subtitle={projectName ? `${dateText} · ${projectName}` : dateText}
      onBack={onDone}
      backLabel="My reports"
      footer={footer}
    >
      {/* Today at a glance - updates live as hours change */}
      <HeroCard
        eyebrow={dateText}
        badge={id ? 'Draft' : 'New'}
        title={projectName ?? 'Choose a project'}
        figures={[
          { label: 'Total man-hours', value: totalHours(crew).toFixed(1), unit: 'h', main: true },
          { label: 'Crew', value: crew.length },
          { label: 'Plant hours', value: totalHours(equipmentLines).toFixed(1), unit: 'h' },
        ]}
      />

      <Section title="Project">
        {projectChoices.length === 0 ? (
          <Row icon={MapPinIcon} title="No active projects" subtitle="Ask the owner to add one." />
        ) : (
          <Row
            icon={MapPinIcon}
            title={projectName ?? 'Choose a project'}
            tone={projectName ? undefined : 'accent'}
            chevron
            onClick={() => setPickingProject(true)}
          />
        )}
        <FieldRow
          icon={CalendarBlankIcon}
          label="Date"
          type="date"
          value={form.report_date}
          onChange={(e) => setField('report_date', e.target.value)}
        />
      </Section>

      <Section
        title="Times"
        footer={siteHours ? `${siteHours.toFixed(1)} hours on site` : 'Set a start and end time.'}
      >
        <FieldRow
          icon={ClockIcon}
          label="Start"
          type="time"
          value={form.start_time}
          onChange={(e) => setField('start_time', e.target.value)}
        />
        <FieldRow
          icon={ClockIcon}
          label="End"
          type="time"
          value={form.end_time}
          onChange={(e) => setField('end_time', e.target.value)}
        />
      </Section>

      <Section
        title={`Crew · ${crew.length}`}
        action={
          crew.length > 0
            ? { label: editingList === 'crew' ? 'Done' : 'Edit', onClick: () => toggleEditing('crew') }
            : undefined
        }
      >
        {crew.map((line) => {
          const name = employeeName[line.employee_id] ?? 'Unknown'
          return (
            <Row
              key={line.employee_id}
              title={name}
              leading={
                editingList === 'crew'
                  ? removeButton(`Remove ${name}`, () => removeCrew(line.employee_id))
                  : undefined
              }
              trailing={
                <Stepper
                  label={`${name} hours`}
                  value={line.hours}
                  min={0.5}
                  unit="h"
                  onChange={(hours) => setCrewHours(line.employee_id, hours)}
                />
              }
            />
          )
        })}
        <Row icon={PlusIcon} tone="accent" title="Add person" onClick={() => setShowCrewPicker(true)} />
        <Row tone="strong" title="Total man-hours" trailing={`${totalHours(crew).toFixed(1)} h`} />
      </Section>

      <Section
        title={`Equipment · ${equipmentLines.length}`}
        action={
          equipmentLines.length > 0
            ? {
                label: editingList === 'equipment' ? 'Done' : 'Edit',
                onClick: () => toggleEditing('equipment'),
              }
            : undefined
        }
      >
        {equipmentLines.map((line) => {
          const name = machineName[line.equipment_id] ?? 'Unknown'
          return (
            <Row
              key={line.equipment_id}
              title={name}
              leading={
                editingList === 'equipment'
                  ? removeButton(`Remove ${name}`, () => removeEquipment(line.equipment_id))
                  : undefined
              }
              trailing={
                <Stepper
                  label={`${name} hours`}
                  value={line.hours}
                  min={0.5}
                  unit="h"
                  onChange={(hours) => setEquipmentHours(line.equipment_id, hours)}
                />
              }
            />
          )
        })}
        <Row
          icon={PlusIcon}
          tone="accent"
          title="Add equipment"
          onClick={() => setShowEquipmentPicker(true)}
        />
        <Row tone="strong" title="Plant hours" trailing={`${totalHours(equipmentLines).toFixed(1)} h`} />
      </Section>

      <Section title="Conditions">
        <FieldRow
          icon={GasPumpIcon}
          label="Fuel"
          type="number"
          inputMode="decimal"
          min="0"
          step="0.1"
          placeholder="0"
          suffix="L"
          inputWidth="5.5rem"
          value={form.fuel_litres}
          onChange={(e) => setField('fuel_litres', e.target.value)}
        />
        <Row
          icon={CloudRainIcon}
          title="Rain"
          trailing={
            <Stepper
              label="Rain"
              value={form.rain_percent}
              step={10}
              max={100}
              unit="%"
              onChange={(value) => setField('rain_percent', value)}
            />
          }
        />
        <Row
          icon={HourglassIcon}
          title="Delay"
          trailing={
            <Stepper
              label="Delay hours"
              value={form.delay_hours}
              unit="h"
              onChange={(value) => setField('delay_hours', value)}
            />
          }
        />
      </Section>

      <Section title="Safety">
        {SAFETY_ITEMS.map(([key, label]) => (
          <SwitchRow
            key={key}
            icon={SAFETY_ICONS[key]}
            title={label}
            checked={form[key]}
            alert={key === 'near_miss'}
            onChange={(value) => setField(key, value)}
          />
        ))}
      </Section>

      <Section title="Activities" plain>
        <TextAreaGroup
          label="Activities"
          placeholder="What was done today, e.g. excavated and bedded 18 m of 900 mm pipe."
          value={form.activities}
          onChange={(e) => setField('activities', e.target.value)}
        />
      </Section>

      {pickingProject && (
        <PickSheet
          title="Project"
          options={projectChoices.map((p) => ({ value: p.id, title: p.name }))}
          selected={form.project_id}
          onPick={(value) => setField('project_id', value)}
          onClose={() => setPickingProject(false)}
        />
      )}

      {showCrewPicker && (
        <PickSheet
          title="Add person"
          hint="People already on the report aren’t shown."
          mode="add"
          options={availableEmployees.map((e) => ({ value: e.id, title: e.full_name }))}
          emptyText="Everyone is already on the report."
          onPick={addCrew}
          onClose={() => setShowCrewPicker(false)}
        />
      )}

      {showEquipmentPicker && (
        <PickSheet
          title="Add equipment"
          hint="Machines already on the report aren’t shown."
          mode="add"
          options={availableMachines.map((m) => ({ value: m.id, title: m.name }))}
          emptyText="All equipment is already on the report."
          onPick={addEquipment}
          onClose={() => setShowEquipmentPicker(false)}
        />
      )}
    </Page>
  )
}

export default ReportForm
