import { supabase } from './supabaseClient'

// OWNER/ADMIN SCREENS ONLY. The dashboard's numbers, straight from the
// database functions in supabase/migrations/20261006090000_dashboard.sql.
// Every total, percentage and sum is worked out by the database; the screen
// only formats and draws what comes back. Nothing is kept on the device -
// it lives in memory while the dashboard is open.

async function call(fn, args = {}) {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw error
  return data
}

// The date-range presets, in the order they're shown.
export const PERIODS = {
  this_week: 'This week',
  this_month: 'This month',
  last_month: 'Last month',
  project_to_date: 'To date',
}

// { from_date, to_date } for a preset - South African time, weeks from Monday.
export async function fetchPeriod(preset, projectId) {
  const rows = await call('dashboard_period', { p_preset: preset, p_project_id: projectId })
  return rows[0] ?? null
}

// Everything that depends on the project and date range, in one go.
//   cumulative: spend vs budget over the whole job (ignores the date range)
//   projects:   the health board - only needed for "All projects"
export async function fetchDashboard(projectId, from, to) {
  const args = { p_project_id: projectId, p_from: from, p_to: to }
  const [summary, categories, weeklyMix, mix, vendors, cumulative, projects] = await Promise.all([
    call('dashboard_summary', args),
    call('dashboard_categories', args),
    call('dashboard_weekly_mix', args),
    call('dashboard_mix', args),
    call('dashboard_top_vendors', args),
    call('dashboard_cumulative', { p_project_id: projectId }),
    projectId ? [] : call('dashboard_projects', { p_from: from, p_to: to }),
  ])
  return { summary: summary[0] ?? null, categories, weeklyMix, mix, vendors, cumulative, projects }
}

// What's waiting, across all projects.
export async function fetchActionItems() {
  const rows = await call('dashboard_action_items')
  return rows[0] ?? null
}

// One employee's month: hours per day (with the reports behind them) and the
// month's totals. month = the first day of the month, "YYYY-MM-01".
export async function fetchEmployeeMonth(employeeId, month, projectId) {
  const args = { p_employee_id: employeeId, p_month: month, p_project_id: projectId }
  const [days, summary] = await Promise.all([
    call('employee_hours_by_day', args),
    call('employee_month_summary', args),
  ])
  return { days, summary: summary[0] ?? null }
}
