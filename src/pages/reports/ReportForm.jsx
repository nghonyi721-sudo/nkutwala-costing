import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import {
  EMPLOYEE_COLUMNS,
  addEmployee,
  assignToProject,
  fetchTeam,
  findDuplicates,
  removeFromProject,
  updateEmployeeDetails,
} from '../../lib/employeeSteps'
import { EMPLOYEE_CATEGORY_LABELS, formatDate, hoursBetween, todayLocal } from '../../lib/labels'
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
  PlusCircleIcon,
  UserPlusIcon,
  UsersThreeIcon,
  WarningIcon,
} from '../../components/icons'
import ConfirmSheet from '../../components/ConfirmSheet'
import DateTimeField from '../../components/DateTimeField'
import StatusBadge from '../../components/StatusBadge'
import SummaryCard from '../../components/SummaryCard'
import Notice from '../../components/Notice'
import Page from '../../components/Page'
import PersonSheet from '../../components/PersonSheet'
import ReportSummary from '../../components/ReportSummary'
import { FieldRow, Row, SwitchRow } from '../../components/Row'
import Section from '../../components/Section'
import Sheet, { PickSheet, SheetGroup } from '../../components/Sheet'
import Skeleton from '../../components/Skeleton'
import Stepper from '../../components/Stepper'
import TextAreaGroup from '../../components/TextAreaGroup'
import CrewRow from './CrewRow'
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

// The database refuses any change to a report dated inside a closed or
// paid pay period, with exactly this message.
const PERIOD_CLOSED = 'This period is closed. Contact the office.'
const isPeriodClosed = (error) => String(error?.message ?? '').includes(PERIOD_CLOSED)

function saveErrorMessage(error) {
  if (isPeriodClosed(error)) return PERIOD_CLOSED
  if (error.code === '23505') {
    return 'You already have a report for this project and date. Open it from My reports.'
  }
  if (error.code === '42501') {
    return 'This report can no longer be changed - it may have been submitted. Go back to My reports.'
  }
  if (error.code === '23514') {
    return 'A number is out of range. Hours must be between 0 and 24; fuel cannot be negative.'
  }
  return 'Could not save. Check your signal and tap Save again - your entries are still here.'
}

// A person on today's crew.
//   hours:   their hours, used when follows is off
//   follows: their hours follow the shift (end − start) until changed
//   absent:  not here today - saved as 0 hours, the row stays
function crewLine(employeeId) {
  return { employee_id: employeeId, hours: 8, follows: true, absent: false }
}

// Everyone, by name, with any newcomers added.
function withPeople(current, people) {
  const known = new Set(current.map((e) => e.id))
  return [...current, ...people.filter((e) => !known.has(e.id))].sort((a, b) =>
    a.full_name.localeCompare(b.full_name),
  )
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
  const [crew, setCrew] = useState([]) // [crewLine]
  // Once the manager changes the crew, it's never replaced by the team list.
  const [crewTouched, setCrewTouched] = useState(false)
  const [equipmentLines, setEquipmentLines] = useState([]) // [{ equipment_id, hours }]
  const [showCrewPicker, setShowCrewPicker] = useState(false)
  const [showEquipmentPicker, setShowEquipmentPicker] = useState(false)

  // Adding or fixing a person: null, { person: null } (new) or { person }
  const [personSheet, setPersonSheet] = useState(null)
  const [personBusy, setPersonBusy] = useState(false)
  const [personError, setPersonError] = useState('')
  // Same-name people found before adding someone new: { matches, details }
  const [sameName, setSameName] = useState(null)
  // The person being taken off the project team (asks first)
  const [removing, setRemoving] = useState(null)
  const [removeBusy, setRemoveBusy] = useState(false)

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
    // Saved hours are kept as they are; 0 hours means Absent.
    setCrew(
      report.report_crew.map((line) => {
        const hours = Number(line.hours)
        return hours === 0
          ? { ...crewLine(line.employee_id), absent: true }
          : { employee_id: line.employee_id, hours, follows: false, absent: false }
      }),
    )
    setCrewTouched(true)
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
      supabase.from('employees').select(EMPLOYEE_COLUMNS).order('full_name'),
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
  // day, open it instead of starting a duplicate. Otherwise start the crew
  // with the project's team (until the manager changes the crew).
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
        if (cancelled) return
        if (data) {
          const { data: report } = await fetchReport(data.id)
          if (cancelled || !report) return
          applyReport(report)
          setMessage('You already have a report for this project and day, so it has been opened.')
          return
        }
        if (crewTouched) return
        try {
          const team = await fetchTeam(supabase, form.project_id)
          if (cancelled) return
          setEmployees((current) => withPeople(current, team))
          setCrew(team.map((person) => crewLine(person.id)))
        } catch {
          if (!cancelled) setError("Could not load the project's team. Check your signal - you can still add people.")
        }
      })

    return () => {
      cancelled = true
    }
  }, [id, loading, form.project_id, form.report_date, user.id, crewTouched])

  function setField(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
    setMessage('')
  }

  // The shift length (end − start); 8 h until both times are set.
  const defaultHours = Math.min(24, hoursBetween(form.start_time, form.end_time) ?? 8)
  // A person's hours today (0 when absent).
  const hoursOf = (line) => (line.absent ? 0 : line.follows ? defaultHours : line.hours)

  function changeCrew(change) {
    setCrew(change)
    setCrewTouched(true)
    setMessage('')
  }

  // Adds someone to today's crew and to this project's team.
  async function addCrew(employeeId) {
    if (crew.some((line) => line.employee_id === employeeId)) return
    changeCrew((current) => [...current, crewLine(employeeId)])
    if (!form.project_id) return
    try {
      await assignToProject(supabase, form.project_id, employeeId)
    } catch {
      setError("Added to today's report, but not to the project's team. Check your signal.")
    }
  }

  function setCrewHours(employeeId, hours) {
    changeCrew((current) =>
      current.map((line) => (line.employee_id === employeeId ? { ...line, hours, follows: false } : line)),
    )
  }

  function toggleAbsent(employeeId) {
    changeCrew((current) =>
      current.map((line) => (line.employee_id === employeeId ? { ...line, absent: !line.absent } : line)),
    )
  }

  // Edit → remove (after asking): off today's report AND off the project's
  // team, so they're not loaded on the next report. Absent is for "not here
  // today".
  async function removeFromTeam(employeeId) {
    setRemoveBusy(true)
    try {
      if (form.project_id) await removeFromProject(supabase, form.project_id, employeeId)
      changeCrew((current) => current.filter((line) => line.employee_id !== employeeId))
      setRemoving(null)
    } catch {
      setError('Could not take them off the team. Check your signal and try again.')
      setRemoving(null)
    }
    setRemoveBusy(false)
  }

  // New person: warn first if someone with the same name already exists.
  async function savePerson(details) {
    setPersonError('')
    setPersonBusy(true)
    try {
      if (personSheet.person) {
        const updated = await updateEmployeeDetails(supabase, personSheet.person.id, details)
        setEmployees((current) => withPeople(current.filter((e) => e.id !== updated.id), [updated]))
        setPersonSheet(null)
      } else {
        const matches = (await findDuplicates(supabase, details.fullName)).filter(
          (match) => match.status !== 'inactive',
        )
        if (matches.length > 0) setSameName({ matches, details })
        else await addNewPerson(details)
      }
    } catch {
      setPersonError('Could not save. Check your signal and try again.')
    }
    setPersonBusy(false)
  }

  async function addNewPerson(details) {
    const person = await addEmployee(supabase, details)
    setEmployees((current) => withPeople(current, [person]))
    setPersonSheet(null)
    setSameName(null)
    await addCrew(person.id)
  }

  // From the same-name warning: use the person who's already there...
  function pickExisting(employeeId) {
    setSameName(null)
    setPersonSheet(null)
    addCrew(employeeId)
  }

  // ...or add the new person anyway.
  async function addAnyway() {
    setPersonBusy(true)
    try {
      await addNewPerson(sameName.details)
    } catch {
      setSameName(null)
      setPersonError('Could not save. Check your signal and try again.')
    }
    setPersonBusy(false)
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
    let result
    try {
      result = await supabase.rpc('save_report_draft', {
        p_report: { ...form, id, fuel_litres: fuel },
        p_crew: crew.map((line) => ({ employee_id: line.employee_id, hours: hoursOf(line) })),
        p_equipment: equipmentLines,
      })
    } catch (networkError) {
      result = { data: null, error: networkError }
    } finally {
      // Never left "Saving…": the buttons always come back.
      setBusy(false)
    }
    const { data, error: saveError } = result

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

  // The "Submit report?" dialog ALWAYS closes (finally), and on success it
  // closes before the report is shown as submitted.
  async function submit() {
    try {
      const savedId = await save()
      if (!savedId) return

      setBusy(true)
      const { data, error: submitError } = await supabase
        .from('daily_reports')
        .update({ status: 'submitted' })
        .eq('id', savedId)
        .eq('status', 'draft')
        .select('id')
      if (submitError || data.length === 0) {
        setError(
          isPeriodClosed(submitError) ? PERIOD_CLOSED : 'Saved as a draft, but could not submit. Check your signal and try again.',
        )
        return
      }

      setConfirming(false)
      const { data: report } = await fetchReport(savedId)
      if (report) applyReport(report)
    } catch {
      setError('Could not submit. Check your signal, then open the report again to see if it went through.')
    } finally {
      setBusy(false)
      setConfirming(false)
    }
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
  const employeeById = Object.fromEntries(employees.map((e) => [e.id, e]))
  const machineName = Object.fromEntries(machines.map((m) => [m.id, m.name]))
  const availableEmployees = employees.filter(
    (e) => e.status !== 'inactive' && !crew.some((line) => line.employee_id === e.id),
  )
  const present = crew.filter((line) => !line.absent).map((line) => ({ hours: hoursOf(line) }))
  const absentCount = crew.length - present.length
  const manHours = totalHours(present)
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
    <ActionBar message={error || message} tone={error ? 'error' : 'info'}>
      <Button variant="secondary" busy={busy && !confirming} disabled={busy} onClick={save}>
        {busy && !confirming ? 'Saving…' : 'Save draft'}
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
      {/* The day at a glance - updates live as hours change */}
      <SummaryCard
        icon={UsersThreeIcon}
        label="Man-hours"
        meta={<StatusBadge status="draft" label={id ? 'Draft' : 'New'} />}
        value={manHours.toFixed(1)}
        unit="h"
        figures={[
          { label: 'Crew', value: present.length },
          ...(absentCount > 0 ? [{ label: 'Absent', value: absentCount }] : []),
          { label: 'Plant hours', value: totalHours(equipmentLines).toFixed(1), unit: 'h' },
          { label: 'On site', value: siteHours ? siteHours.toFixed(1) : '–', unit: siteHours ? 'h' : '' },
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
        <Row
          icon={CalendarBlankIcon}
          title="Date"
          trailing={
            <DateTimeField
              type="date"
              label="Report date"
              value={form.report_date}
              onChange={(e) => setField('report_date', e.target.value)}
            />
          }
        />
      </Section>

      <Section
        title="Times"
        footer={siteHours ? `${siteHours.toFixed(1)} hours on site` : 'Set a start and end time.'}
      >
        <Row
          icon={ClockIcon}
          title="Start"
          trailing={
            <DateTimeField
              type="time"
              label="Start time"
              value={form.start_time}
              onChange={(e) => setField('start_time', e.target.value)}
            />
          }
        />
        <Row
          icon={ClockIcon}
          title="End"
          trailing={
            <DateTimeField
              type="time"
              label="End time"
              value={form.end_time}
              onChange={(e) => setField('end_time', e.target.value)}
            />
          }
        />
      </Section>

      <Section
        title={`Crew · ${present.length}${absentCount > 0 ? ` · ${absentCount} absent` : ''}`}
        action={
          crew.length > 0
            ? { label: editingList === 'crew' ? 'Done' : 'Edit', onClick: () => toggleEditing('crew') }
            : undefined
        }
        footer={
          editingList === 'crew'
            ? "Removing someone takes them off this project's team. If they're just not here today, tap Absent instead."
            : undefined
        }
      >
        {crew.map((line) => {
          const person = employeeById[line.employee_id]
          const name = person?.full_name ?? 'Unknown'
          const mine = person?.status === 'pending' && person.created_by === user.id
          return (
            <CrewRow
              key={line.employee_id}
              name={name}
              hours={hoursOf(line)}
              absent={line.absent}
              pending={person?.status === 'pending'}
              onHours={(hours) => setCrewHours(line.employee_id, hours)}
              onToggleAbsent={() => toggleAbsent(line.employee_id)}
              onEditName={mine ? () => setPersonSheet({ person }) : undefined}
              leading={
                editingList === 'crew'
                  ? removeButton(`Remove ${name} from the team`, () => setRemoving(person ?? { id: line.employee_id, full_name: name }))
                  : undefined
              }
            />
          )
        })}
        <Row
          icon={UserPlusIcon}
          tone="accent"
          title="Add someone not on the list"
          onClick={() => setShowCrewPicker(true)}
        />
        <Row tone="strong" title="Total man-hours" trailing={`${manHours.toFixed(1)} h`} />
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
          icon={PlusCircleIcon}
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

      {confirming && (
        <ConfirmSheet
          title="Submit report?"
          message={`${projectName ?? 'This report'} · ${dateText}. You can't change it after you submit - only the owner can reopen it.`}
          actionLabel={busy ? 'Submitting…' : 'Submit report'}
          busy={busy}
          onConfirm={submit}
          onCancel={() => setConfirming(false)}
        />
      )}

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
        <Sheet
          title="Add someone"
          hint="They're added to today's report and to this project's team. People already on the report aren’t shown."
          onClose={() => setShowCrewPicker(false)}
        >
          <SheetGroup>
            <Row
              icon={UserPlusIcon}
              tone="accent"
              title="New person"
              subtitle="Not in the list below"
              onClick={() => {
                setShowCrewPicker(false)
                setPersonError('')
                setPersonSheet({ person: null })
              }}
            />
          </SheetGroup>
          <SheetGroup>
            {availableEmployees.length === 0 && <Row title="Everyone is already on the report." />}
            {availableEmployees.map((e) => (
              <Row
                key={e.id}
                icon={PlusCircleIcon}
                tone="accent"
                title={e.full_name}
                subtitle={
                  EMPLOYEE_CATEGORY_LABELS[e.category] + (e.status === 'pending' ? ' · Pending' : '')
                }
                onClick={() => addCrew(e.id)}
              />
            ))}
          </SheetGroup>
        </Sheet>
      )}

      {personSheet && (
        <PersonSheet
          person={personSheet.person}
          busy={personBusy}
          error={personError}
          onSave={savePerson}
          onClose={() => setPersonSheet(null)}
        />
      )}

      {sameName && (
        <ConfirmSheet
          title="Already on the list?"
          message={`${sameName.matches.map((m) => m.full_name).join(', ')} ${sameName.matches.length === 1 ? 'is' : 'are'} already in the company. Use them, unless this is a different person with the same name.`}
          busy={personBusy}
          onCancel={() => setSameName(null)}
          actions={[
            ...sameName.matches.slice(0, 3).map((m) =>
              crew.some((line) => line.employee_id === m.id)
                ? { label: `${m.full_name} is already on today's report`, onClick: () => pickExisting(m.id) }
                : {
                    label: `Use ${m.full_name} (${EMPLOYEE_CATEGORY_LABELS[m.category]})`,
                    onClick: () => pickExisting(m.id),
                  },
            ),
            { label: 'Add a new person anyway', onClick: addAnyway, busy: personBusy },
          ]}
        />
      )}

      {removing && (
        <ConfirmSheet
          title={`Remove ${removing.full_name} from the team?`}
          message="They come off today's report and won't be loaded on this project's next report. If they're just not here today, use Absent instead."
          actionLabel={removeBusy ? 'Removing…' : 'Remove from team'}
          destructive
          busy={removeBusy}
          onConfirm={() => removeFromTeam(removing.id)}
          onCancel={() => setRemoving(null)}
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
