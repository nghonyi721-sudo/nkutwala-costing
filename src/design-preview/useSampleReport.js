import { useState } from 'react'
import { formatDate, hoursBetween, todayLocal } from '../lib/labels'
import { SAFETY_ITEMS, SAMPLE_EMPLOYEES, SAMPLE_EQUIPMENT, SAMPLE_PROJECTS } from './sampleData'

// TEMPORARY - the daily report screen's behaviour for /design-preview, shared
// by all three directions so they differ only in how they look.
// Everything stays in the page: nothing is saved or sent anywhere.

const round = (number) => Math.round(number * 100) / 100

// value + delta, kept between min and max.
export function step(value, delta, min, max) {
  return Math.min(max, Math.max(min, round(value + delta)))
}

const clock = () => new Date().toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })

// A half-finished report, so every direction shows filled and empty sections.
function initialReport() {
  return {
    projectId: 'p1',
    date: todayLocal(),
    start: '07:00',
    end: '16:30',
    crew: [
      { id: 'e1', hours: 9.5 },
      { id: 'e2', hours: 9.5 },
      { id: 'e4', hours: 8 },
      { id: 'e6', hours: 7 },
    ],
    equipment: [],
    fuel: '120',
    rain: 10,
    delay: 0.5,
    safety: { dsti: true, audit: false, nearMiss: false, moment: true },
    activities: '',
  }
}

const byId = (list) => Object.fromEntries(list.map((item) => [item.id, item]))
const EMPLOYEES = byId(SAMPLE_EMPLOYEES)
const EQUIPMENT = byId(SAMPLE_EQUIPMENT)

export default function useSampleReport() {
  const [report, setReport] = useState(initialReport)
  const [status, setStatus] = useState('draft') // 'draft' | 'submitted'
  const [confirming, setConfirming] = useState(false)
  // { tone: 'saved' | 'submitted' | 'warning', text }
  const [message, setMessage] = useState(null)

  function update(changes) {
    setReport((current) => ({ ...current, ...changes }))
    setMessage(null)
  }

  function addLine(list, id) {
    const hours = Math.min(24, hoursBetween(report.start, report.end) ?? 8)
    update({ [list]: [...report[list], { id, hours }] })
  }

  function setLineHours(list, id, hours) {
    update({ [list]: report[list].map((line) => (line.id === id ? { ...line, hours } : line)) })
  }

  function removeLine(list, id) {
    update({ [list]: report[list].filter((line) => line.id !== id) })
  }

  function setSafety(key, value) {
    update({ safety: { ...report.safety, [key]: value } })
  }

  function askSubmit() {
    if (!report.projectId) {
      setMessage({ tone: 'warning', text: 'Choose a project first.' })
      return
    }
    setMessage(null)
    setConfirming(true)
  }

  function confirmSubmit() {
    setConfirming(false)
    setStatus('submitted')
    setMessage({ tone: 'submitted', text: `Submitted at ${clock()}` })
  }

  function reset() {
    setReport(initialReport())
    setStatus('draft')
    setConfirming(false)
    setMessage(null)
  }

  const project = SAMPLE_PROJECTS.find((p) => p.id === report.projectId) ?? null
  const crewLines = report.crew.map((line) => ({ ...EMPLOYEES[line.id], ...line }))
  const equipmentLines = report.equipment.map((line) => ({ ...EQUIPMENT[line.id], ...line }))
  const manHours = report.crew.reduce((sum, line) => sum + line.hours, 0)
  const plantHours = report.equipment.reduce((sum, line) => sum + line.hours, 0)
  const siteHours = hoursBetween(report.start, report.end)
  const safetyYes = SAFETY_ITEMS.filter((item) => report.safety[item.key]).length
  const dateLabel = report.date ? formatDate(report.date) : 'No date'
  const people = (n) => `${n} ${n === 1 ? 'person' : 'people'}`
  const machines = (n) => `${n} ${n === 1 ? 'machine' : 'machines'}`

  const sections = [
    {
      key: 'project',
      title: 'Project & date',
      done: Boolean(project && report.date),
      summary: project ? `${project.name} · ${dateLabel}` : 'Not chosen yet',
    },
    {
      key: 'times',
      title: 'Times',
      done: Boolean(siteHours),
      summary: siteHours
        ? `${report.start} – ${report.end} · ${siteHours.toFixed(1)} h on site`
        : 'Not set',
    },
    {
      key: 'crew',
      title: 'Crew',
      done: report.crew.length > 0,
      summary: `${people(report.crew.length)} · ${manHours.toFixed(1)} h`,
    },
    {
      key: 'equipment',
      title: 'Equipment',
      done: report.equipment.length > 0,
      summary: report.equipment.length
        ? `${machines(report.equipment.length)} · ${plantHours.toFixed(1)} h`
        : 'None added yet',
    },
    {
      key: 'conditions',
      title: 'Conditions',
      done: report.fuel !== '',
      summary: `Fuel ${report.fuel || 0} L · rain ${report.rain}% · delay ${report.delay} h`,
    },
    {
      key: 'safety',
      title: 'Safety',
      done: report.safety.dsti,
      summary: report.safety.dsti ? `DSTI done · ${safetyYes} of 4 yes` : 'DSTI not done yet',
    },
    {
      key: 'activities',
      title: 'Activities',
      done: report.activities.trim() !== '',
      summary: report.activities.trim() || 'Nothing written yet',
    },
  ]

  return {
    ...report,
    status,
    locked: status === 'submitted',
    confirming,
    message,
    project,
    projects: SAMPLE_PROJECTS,
    dateLabel,
    crewLines,
    equipmentLines,
    availableEmployees: SAMPLE_EMPLOYEES.filter((e) => !report.crew.some((l) => l.id === e.id)),
    availableEquipment: SAMPLE_EQUIPMENT.filter((q) => !report.equipment.some((l) => l.id === q.id)),
    manHours,
    plantHours,
    siteHours,
    sections,
    doneCount: sections.filter((section) => section.done).length,
    safetyItems: SAFETY_ITEMS,
    set: (field, value) => update({ [field]: value }),
    addCrew: (id) => addLine('crew', id),
    removeCrew: (id) => removeLine('crew', id),
    setCrewHours: (id, hours) => setLineHours('crew', id, hours),
    addEquipment: (id) => addLine('equipment', id),
    removeEquipment: (id) => removeLine('equipment', id),
    setEquipmentHours: (id, hours) => setLineHours('equipment', id, hours),
    setSafety,
    save: () => setMessage({ tone: 'saved', text: `Draft saved at ${clock()}` }),
    askSubmit,
    cancelSubmit: () => setConfirming(false),
    confirmSubmit,
    reset,
  }
}
