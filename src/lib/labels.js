// Friendly names and formatting shared across screens.

export const ROLE_LABELS = {
  system_admin: 'System admin',
  owner: 'Owner',
  site_manager: 'Site manager',
}

export const PROJECT_STATUS_LABELS = {
  active: 'Active',
  on_hold: 'On hold',
  complete: 'Complete',
}

export const EMPLOYEE_CATEGORY_LABELS = {
  site_manager: 'Site manager',
  site_agent: 'Site agent',
  diver: 'Diver',
  operator: 'Operator',
  semi_skilled: 'Semi-skilled',
  general_worker: 'General worker',
}

export function isOwnerOrAdmin(role) {
  return role === 'owner' || role === 'system_admin'
}

const randFormat = new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' })

// 1250 -> "R 1 250,00"
export function formatRand(value) {
  return randFormat.format(Number(value))
}

// Today's date on this device as "YYYY-MM-DD" (the site's local calendar date).
export function todayLocal() {
  return new Date().toLocaleDateString('en-CA')
}

// "2026-06-01" -> "1 Jun 2026". Built from the parts so the time zone can't
// shift it to the previous day.
export function formatDate(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString('en-ZA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export const EQUIPMENT_OWNERSHIP_LABELS = {
  own: 'Own',
  rented: 'Rented',
}

export const REPORT_STATUS_LABELS = {
  draft: 'Draft',
  submitted: 'Submitted',
}

// "07:30:00" -> "07:30"
export function formatTime(time) {
  return time ? time.slice(0, 5) : '-'
}

// A database timestamp shown in this device's local time.
export function formatDateTime(timestamp) {
  return new Date(timestamp).toLocaleString('en-ZA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// Hours between two "HH:MM" times, rounded to the nearest half hour.
// Returns null if either is missing or end isn't after start.
export function hoursBetween(start, end) {
  if (!start || !end) return null
  const toMinutes = (time) => {
    const [h, m] = time.split(':').map(Number)
    return h * 60 + m
  }
  const minutes = toMinutes(end) - toMinutes(start)
  if (minutes <= 0) return null
  return Math.round((minutes / 60) * 2) / 2
}
