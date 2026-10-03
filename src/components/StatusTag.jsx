import { REPORT_STATUS_LABELS } from '../lib/labels'

// Which colour each status gets. Blue = live/done, red = voided, grey = the rest.
const TONES = {
  submitted: 'blue',
  active: 'blue',
  current: 'blue',
  voided: 'red',
}

// Square status tag in small caps, e.g. DRAFT (grey), SUBMITTED (blue).
// label defaults to the report status name.
function StatusTag({ status, label }) {
  const tone = TONES[status] ?? 'grey'
  return <span className={`tag tag-${tone}`}>{label ?? REPORT_STATUS_LABELS[status] ?? status}</span>
}

export default StatusTag
