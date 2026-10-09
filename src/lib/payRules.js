import { supabase } from './supabaseClient'
import { formatDate } from './labels'

// OWNER/ADMIN SCREENS ONLY: pay rules and public holidays (phase 8A). Rules
// are dated and never edited: a change is a NEW rule from a date; a wrong one
// is voided with a reason (kept in the history). The first rule can never be
// voided. Anything that would change days already in a closed or paid pay
// run is refused by the database (8B-1).

export const RULE_COLUMNS =
  'id, effective_from, daily_ot_threshold_hours, ot_multiplier, weekly_ot_enabled, weekly_ot_threshold_hours, ' +
  'sunday_enabled, sunday_multiplier, public_holiday_enabled, public_holiday_multiplier, warn_weekly_ot_hours, ' +
  'warn_daily_hours, created_at, voided_at, void_reason, created_by_profile:profiles!pay_rules_created_by_fkey(full_name)'

// Every rule, newest start date first.
export async function fetchRules() {
  const { data, error } = await supabase
    .from('pay_rules')
    .select(RULE_COLUMNS)
    .order('effective_from', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

// The live rule a day is worked out with: the latest live rule starting on
// or before it. (Picking a row - nothing is added up.)
export function ruleOn(rules, day) {
  return (rules ?? []).find((rule) => !rule.voided_at && rule.effective_from <= day) ?? null
}

// The live rule with the earliest start: it can never be voided.
export function firstRule(rules) {
  const live = (rules ?? []).filter((rule) => !rule.voided_at)
  return live.length ? live[live.length - 1] : null
}

// The settings a new rule is saved with (numbers as the steppers hold them).
export const RULE_FIELDS = [
  'daily_ot_threshold_hours',
  'ot_multiplier',
  'weekly_ot_enabled',
  'weekly_ot_threshold_hours',
  'sunday_enabled',
  'sunday_multiplier',
  'public_holiday_enabled',
  'public_holiday_multiplier',
  'warn_weekly_ot_hours',
  'warn_daily_hours',
]

export async function addRule(rule) {
  const values = Object.fromEntries(RULE_FIELDS.map((field) => [field, rule[field]]))
  const { error } = await supabase.from('pay_rules').insert({ ...values, effective_from: rule.effective_from })
  if (error) throw error
}

export async function voidRule(ruleId, reason) {
  const { data, error } = await supabase.from('pay_rules').update({ void_reason: reason }).eq('id', ruleId).select('id')
  if (error) throw error
  if (data.length === 0) throw new Error('Could not void this rule.')
}

// Every holiday, by date (newest year first in the screen).
export async function fetchHolidays() {
  const { data, error } = await supabase
    .from('public_holidays')
    .select('id, holiday_date, name, voided_at, void_reason')
    .order('holiday_date')
  if (error) throw error
  return data
}

export async function addHoliday({ date, name }) {
  const { error } = await supabase.from('public_holidays').insert({ holiday_date: date, name: name.trim() })
  if (error) throw error
}

export async function voidHoliday(holidayId, reason) {
  const { data, error } = await supabase
    .from('public_holidays')
    .update({ void_reason: reason })
    .eq('id', holidayId)
    .select('id')
  if (error) throw error
  if (data.length === 0) throw new Error('Could not void this holiday.')
}

// A database refusal, in words for the screen.
export function ruleError(error, { kind = 'rule', date } = {}) {
  const message = String(error?.message ?? '')
  if (error?.code === '23505') {
    return kind === 'rule'
      ? `There's already a rule from ${date ? formatDate(date) : 'that date'}. Void it first, then add the new one.`
      : `There's already a holiday on ${date ? formatDate(date) : 'that date'}.`
  }
  if (error?.code === '23514' || error?.code === '42501') return message
  return 'Could not save. Check your signal and try again.'
}
