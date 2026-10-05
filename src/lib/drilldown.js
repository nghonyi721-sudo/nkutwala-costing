import { supabase } from './supabaseClient'

// OWNER/ADMIN SCREENS ONLY. The line items behind the dashboard's figures,
// from the drill_* functions (supabase/migrations/20261007150000_rework_c_drilldown.sql)
// and the dashboard's own functions. Every total comes from the database -
// each row carries its level's totals (total_...) - so the screens only
// format and draw. Nothing is kept on the device.
//
//   projectId: one project, or null for all projects
//   period:    { from, to, name } - "YYYY-MM-DD" dates, inclusive

async function call(fn, args) {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw error
  return data
}

const range = (projectId, period) => ({ p_project_id: projectId, p_from: period.from, p_to: period.to })

// The "to date" period of a project (or all projects), as the dashboard
// counts it: from the first cost to today.
export async function fetchToDate(projectId) {
  const rows = await call('dashboard_period', { p_preset: 'project_to_date', p_project_id: projectId })
  const period = rows[0]
  if (!period) throw new Error('No period')
  return { from: period.from_date, to: period.to_date, name: 'To date' }
}

// Spending in a period: the total, by category, per week, and the crew.
export async function fetchSpending(projectId, period) {
  const args = range(projectId, period)
  const [summary, categories, weeks, crew] = await Promise.all([
    call('dashboard_summary', args),
    call('dashboard_categories', args),
    call('dashboard_weekly_mix', args),
    call('drill_hours', { ...args, p_category: 'labour' }),
  ])
  return { summary: summary[0] ?? null, categories, weeks, crew }
}

// Per person (labour) or per owned machine (owned_plant).
export function fetchHours(projectId, period, category) {
  return call('drill_hours', { ...range(projectId, period), p_category: category })
}

// Approved receipts: one category, one vendor, or (both null) all of them.
export function fetchReceipts(projectId, period, { category = null, vendor = null } = {}) {
  return call('drill_receipts', { ...range(projectId, period), p_category: category, p_vendor: vendor })
}

// The hours with no rate, by person/machine and day.
export function fetchUnpriced(projectId, period) {
  return call('drill_unpriced', range(projectId, period))
}

// One person's days: hours, project(s), the rate that day, the day's cost.
export function fetchEmployeeDays(employeeId, projectId, period) {
  return call('drill_employee_days', { p_employee_id: employeeId, ...range(projectId, period) })
}
