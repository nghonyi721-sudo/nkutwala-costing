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
