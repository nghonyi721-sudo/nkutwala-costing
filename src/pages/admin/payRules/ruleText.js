// Pay rules in plain words. Formatting only - the values are the database's.

const n = (value) => String(Number(value))

export const overtimeText = (rule) => `After ${n(rule.daily_ot_threshold_hours)} h a day, at ×${n(rule.ot_multiplier)}`
export const weeklyText = (rule) =>
  rule.weekly_ot_enabled ? `After ${n(rule.weekly_ot_threshold_hours)} h a week, at ×${n(rule.ot_multiplier)}` : 'Off'
export const sundayText = (rule) => (rule.sunday_enabled ? `Every hour at ×${n(rule.sunday_multiplier)}` : 'Off')
export const holidayText = (rule) =>
  rule.public_holiday_enabled ? `Every hour at ×${n(rule.public_holiday_multiplier)}` : 'Off'
export const warningsText = (rule) =>
  `Over ${n(rule.warn_weekly_ot_hours)} h overtime a week, or over ${n(rule.warn_daily_hours)} h in a day`

// One line for the history list, e.g. "8 h · ×1.5 · weekly 45 h".
export function shortText(rule) {
  return [
    `${n(rule.daily_ot_threshold_hours)} h · ×${n(rule.ot_multiplier)}`,
    rule.weekly_ot_enabled ? `weekly ${n(rule.weekly_ot_threshold_hours)} h` : null,
    rule.sunday_enabled ? `Sundays ×${n(rule.sunday_multiplier)}` : null,
    rule.public_holiday_enabled ? `holidays ×${n(rule.public_holiday_multiplier)}` : null,
  ]
    .filter(Boolean)
    .join(' · ')
}
