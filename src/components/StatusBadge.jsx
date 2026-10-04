import { REPORT_STATUS_LABELS } from '../lib/labels'
import s from './StatusBadge.module.css'

// Colour rules: blue = live or done, red = needs attention, grey = the rest.
const TONES = {
  submitted: 'blue',
  active: 'blue',
  current: 'blue',
  voided: 'red',
  alert: 'red',
}

// A coloured dot and a word, e.g. "● Submitted". label defaults to the
// report status name; tone ('blue' | 'red' | 'grey') overrides the colour.
function StatusBadge({ status, label, tone: toneOverride }) {
  const tone = toneOverride ?? TONES[status] ?? 'grey'
  return (
    <span className={`${s.badge} ${s[tone]}`}>
      {label ?? REPORT_STATUS_LABELS[status] ?? status}
    </span>
  )
}

export default StatusBadge
