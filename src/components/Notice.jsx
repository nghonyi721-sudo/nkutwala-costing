import { CheckCircleIcon, InfoIcon, LockIcon, WarningCircleIcon } from './icons'
import s from './Notice.module.css'

const ICONS = {
  info: InfoIcon,
  success: CheckCircleIcon,
  error: WarningCircleIcon,
  locked: LockIcon,
}

// An inline message in a rounded panel.
//   tone: 'info' (blue), 'success' (blue), 'error' (red), 'locked' (grey)
function Notice({ tone = 'info', children }) {
  const Icon = ICONS[tone] ?? InfoIcon
  return (
    <div className={`${s.notice} ${s[tone]}`} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon className={s.icon} size={22} weight={tone === 'success' ? 'fill' : 'regular'} aria-hidden="true" />
      <div className={s.text}>{children}</div>
    </div>
  )
}

export default Notice
