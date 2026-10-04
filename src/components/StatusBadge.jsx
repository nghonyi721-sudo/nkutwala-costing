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
// report status name.
function StatusBadge({ status, label }) {
  const tone = TONES[status] ?? 'grey'
  return (
    <span className={`${s.badge} ${s[tone]}`}>
      {label ?? REPORT_STATUS_LABELS[status] ?? status}
    </span>
  )
}

export default StatusBadge
