import { supabase } from './supabaseClient'

// Everything needed to show one report, with names instead of ids.
// Quantities only - there are no money columns in any of these tables.
const REPORT_DETAIL_SELECT = `
  *,
  project:projects(name),
  reporter:profiles!daily_reports_reporter_id_fkey(full_name),
  reopener:profiles!daily_reports_reopened_by_fkey(full_name),
  report_crew(id, employee_id, hours, employee:employees(full_name)),
  report_equipment(id, equipment_id, hours, equipment:equipment(name))
`

// Returns { data, error }. data is null if the report doesn't exist or the
// user isn't allowed to see it.
export function fetchReport(reportId) {
  return supabase
    .from('daily_reports')
    .select(REPORT_DETAIL_SELECT)
    .eq('id', reportId)
    .maybeSingle()
}

// Sum of hours on crew or equipment lines, e.g. total man-hours.
export function totalHours(lines) {
  return lines.reduce((sum, line) => sum + Number(line.hours), 0)
}
