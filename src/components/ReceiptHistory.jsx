import { formatDateTime } from '../lib/labels'
import {
  ArrowCounterClockwiseIcon,
  CheckCircleIcon,
  MinusCircleIcon,
  NotePencilIcon,
  PaperPlaneTiltIcon,
  XCircleIcon,
} from './icons'
import { Row } from './Row'
import Section from './Section'
import s from './ReceiptHistory.module.css'

const STEPS = {
  draft: { title: 'Saved', icon: NotePencilIcon, tone: 'grey' },
  submitted: { title: 'Submitted', icon: PaperPlaneTiltIcon, tone: 'blue' },
  approved: { title: 'Approved', icon: CheckCircleIcon, tone: 'blue' },
  rejected: { title: 'Rejected', icon: XCircleIcon, tone: 'red' },
  reversed: { title: 'Reversed', icon: ArrowCounterClockwiseIcon, tone: 'red' },
  discarded: { title: 'Discarded', icon: MinusCircleIcon, tone: 'grey' },
}

// A receipt's status log, oldest first: who changed it, when, and why.
// Written by the database itself, so it can't be edited.
//   log:          rows of receipt_status_log, with changer:profiles(full_name)
//   unknownName:  shown when the person's name isn't available to this user
//                 (site managers can't see other people's profiles)
function ReceiptHistory({ log, unknownName = 'Office' }) {
  if (log.length === 0) return null
  return (
    <Section title="History">
      {log.map((entry) => {
        const step = STEPS[entry.to_status] ?? STEPS.draft
        const who = entry.changer?.full_name ?? unknownName
        return (
          <Row
            key={entry.id}
            icon={step.icon}
            iconTone={step.tone}
            title={step.title}
            subtitle={
              <>
                {formatDateTime(entry.changed_at)} · {who}
                {entry.reason && <span className={s.reason}>“{entry.reason}”</span>}
              </>
            }
          />
        )
      })}
    </Section>
  )
}

export default ReceiptHistory
