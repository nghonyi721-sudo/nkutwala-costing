import { formatDate, formatRand } from '../../../lib/labels'

// Formatting only - every number here comes from the database as it is.

export const LOAD_ERROR = 'Could not load this. Check your signal and try again.'

// "This month · 1 Oct 2026 – 5 Oct 2026"
export function periodText(period) {
  const from = formatDate(period.from)
  const dates = period.from === period.to ? from : `${from} – ${formatDate(period.to)}`
  return period.name ? `${period.name} · ${dates}` : dates
}

export const hoursText = (hours) => `${Number(hours).toFixed(1)} h`

// [100, 120] -> "R 100,00/h, R 120,00/h"
export function ratesText(rates) {
  return (rates ?? []).map((rate) => `${formatRand(rate)}/h`).join(', ')
}

export const daysText = (days) => `${days} day${Number(days) === 1 ? '' : 's'}`

// Labour and owned plant costs are flat rate × hours.
export const PROVISIONAL_NOTE =
  'Provisional: hours × the rate on each day. Overtime rules are not applied.'
