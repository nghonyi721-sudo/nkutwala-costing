import { supabase } from './supabaseClient'

// OWNER/ADMIN SCREEN ONLY (the database refuses anyone else): what the
// Payroll screen checks before a download.
//   { submitted_reports, draft_reports, receipts_waiting,
//     unpriced: [{ employee_id, full_name, hours }] }
export async function fetchPayrollChecks(projectId, from, to) {
  const { data, error } = await supabase.rpc('payroll_checks', {
    p_project_id: projectId,
    p_from: from,
    p_to: to,
  })
  if (error) throw error
  return data?.[0] ?? null
}

const DAY = 86400000
const toDate = (isoDate) => {
  const [year, month, day] = isoDate.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}
const toIso = (date) => date.toISOString().slice(0, 10)

// "YYYY-MM-DD" plus (or minus) some days.
export const addDays = (isoDate, days) => toIso(new Date(toDate(isoDate).getTime() + days * DAY))

// The 14-day blocks the payroll splits the dates into - the first starts on
// the start date, the last ends on the end date (the database splits them
// the same way, in payroll_blocks): [{ from, to }]. Only for showing them.
export function fortnights(from, to) {
  const blocks = []
  for (let start = from; start <= to; start = addDays(start, 14)) {
    const end = addDays(start, 13)
    blocks.push({ from: start, to: end < to ? end : to })
  }
  return blocks
}
