import { formatDate } from '../lib/labels'
import s from './DateTimeField.module.css'

// Apple's compact date/time picker: a grey pill showing the value
// ("04 Oct 2026", "07:00"). Tapping it opens the phone's own date or time
// wheel; on a computer it opens the browser's picker. Use it as the trailing
// part of a <Row>.
//   type: 'date' | 'time'
function DateTimeField({ type = 'date', value, onChange, label, placeholder }) {
  const shown = value ? (type === 'date' ? formatDate(value) : value.slice(0, 5)) : null

  return (
    <span className={shown ? s.pill : `${s.pill} ${s.empty}`}>
      <span aria-hidden="true">{shown ?? placeholder ?? (type === 'date' ? 'Set date' : 'Set time')}</span>
      <input
        className={s.native}
        type={type}
        value={value}
        aria-label={label}
        onChange={onChange}
        onClick={(event) => {
          // Desktop browsers only open the picker from their small icon;
          // ask for it directly so the whole pill works.
          try {
            event.currentTarget.showPicker?.()
          } catch {
            // not supported here - the native control still works
          }
        }}
      />
    </span>
  )
}

export default DateTimeField
