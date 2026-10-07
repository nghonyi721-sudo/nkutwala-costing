import { supabase } from './supabaseClient'

// OWNER/ADMIN SCREENS ONLY: pay periods and pay runs. Every figure and total
// comes from the database (the views and functions of phases 8B-1 and 8B-2);
// the database refuses anyone else. Close, mark paid and reopen go through
// the database's own checked functions - the app can't write the snapshot.

async function call(fn, args = {}) {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw error
  return data
}

// Every period, newest first, with its active run's figures.
export async function fetchPeriods() {
  const { data, error } = await supabase
    .from('pay_period_overview')
    .select('*')
    .order('start_date', { ascending: false })
  if (error) throw error
  return data
}

export async function fetchPeriod(periodId) {
  const { data, error } = await supabase.from('pay_period_overview').select('*').eq('id', periodId).maybeSingle()
  if (error) throw error
  return data
}

// The suggested next period: { start_date, end_date, previous_end, gap_days }.
export const fetchNextDates = () => call('next_pay_period_dates').then((rows) => rows[0] ?? null)

// Days between the period before `start` and `start` (null: no earlier period).
export const fetchGap = (start) => call('pay_period_gap', { p_start: start })

export async function createPeriod({ start, end, notes }) {
  const { error } = await supabase
    .from('pay_periods')
    .insert({ start_date: start, end_date: end, notes: notes.trim() })
  if (error) throw error
}

// Only while open or reopened (the database refuses otherwise).
export async function updatePeriod(periodId, { start, end, notes }) {
  const { data, error } = await supabase
    .from('pay_periods')
    .update({ start_date: start, end_date: end, notes: notes.trim() })
    .eq('id', periodId)
    .select('id')
  if (error) throw error
  if (data.length === 0) throw new Error('This pay period can no longer be changed.')
}

export const fetchBlockers = (periodId) => call('pay_period_blockers', { p_period_id: periodId })
export const fetchPreview = (periodId) => call('pay_period_preview', { p_period_id: periodId })
export const closePeriod = (periodId) => call('close_pay_period', { p_period_id: periodId })
export const markPaid = (periodId, paidOn) => call('mark_pay_period_paid', { p_period_id: periodId, p_paid_on: paidOn })
export const reopenPeriod = (periodId, reason) => call('reopen_pay_period', { p_period_id: periodId, p_reason: reason })
export const fetchVersions = (periodId) => call('pay_run_versions', { p_period_id: periodId })

// A run's people: full pay (all projects), from the snapshot.
export const fetchRunPeople = (runId) => call('pay_run_people', { p_run_id: runId, p_project_ids: null })

// The projects in a run's split - the Excel filter's choices: [{ id, name }].
export const fetchRunProjects = (runId) =>
  call('pay_run_projects', { p_run_id: runId }).then((rows) => rows.map((row) => ({ id: row.project_id, name: row.project_name })))

// The "to be paid" list, per person.
export const fetchOutstanding = () => call('pay_outstanding_people')

// A database refusal, in words for the screen. The database's own messages
// for close / mark paid / reopen are already written for people.
export function payError(error) {
  const message = String(error?.message ?? '')
  if (error?.code === '23P01') return 'These dates overlap another pay period.'
  if (message.includes('pay_periods_dates')) return 'The end date must be on or after the start date, and within a year of it.'
  if (error?.code === '23514' || error?.code === '42501') return message
  if (message === 'This pay period can no longer be changed.') return message
  return 'Could not save. Check your signal and try again.'
}
