import { CaretRightIcon } from './icons'
import s from './Row.module.css'

// List rows that live inside a <Section> group, like the phone's Settings.

function rowClass(hasIcon, extra) {
  return [s.row, hasIcon ? s.withIcon : '', extra].filter(Boolean).join(' ')
}

// A row with an optional icon, title, subtitle, something on the right
// (trailing) and a chevron. Becomes a button when onClick is given.
//   tone: 'accent' (blue title, e.g. "Add person"), 'danger' (red title),
//         'strong' (bold title, e.g. totals)
//   leading: something before the icon (e.g. a remove button)
export function Row({
  icon: Icon,
  title,
  subtitle,
  trailing,
  chevron = false,
  onClick,
  tone,
  leading,
  mono = false,
  ...props
}) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      className={rowClass(Icon, tone ? s[tone] : '')}
      onClick={onClick}
      type={onClick ? 'button' : undefined}
      {...props}
    >
      {leading}
      {Icon && <Icon className={s.icon} size={24} aria-hidden="true" />}
      <span className={s.main}>
        <span className={s.title}>{title}</span>
        {subtitle && <span className={mono ? `${s.subtitle} num` : s.subtitle}>{subtitle}</span>}
      </span>
      {trailing !== undefined && trailing !== null && <span className={s.trailing}>{trailing}</span>}
      {chevron && <CaretRightIcon className={s.chevron} size={20} weight="bold" aria-hidden="true" />}
    </Tag>
  )
}

// A row with a label on the left and an input on the right.
export function FieldRow({ icon: Icon, label, suffix, inputWidth, ...inputProps }) {
  return (
    <label className={rowClass(Icon)}>
      {Icon && <Icon className={s.icon} size={24} aria-hidden="true" />}
      <span className={s.main}>
        <span className={s.title}>{label}</span>
      </span>
      <input className={s.input} style={inputWidth ? { width: inputWidth } : undefined} {...inputProps} />
      {suffix && <span className={s.suffix}>{suffix}</span>}
    </label>
  )
}

// An on/off row; the whole row is the tap target.
//   alert: "on" is a warning (e.g. near miss), so it shows red.
export function SwitchRow({ icon: Icon, title, subtitle, checked, onChange, alert = false, ...props }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={rowClass(Icon)}
      onClick={() => onChange(!checked)}
      {...props}
    >
      {Icon && <Icon className={s.icon} size={24} aria-hidden="true" />}
      <span className={s.main}>
        <span className={s.title}>{title}</span>
        {subtitle && <span className={s.subtitle}>{subtitle}</span>}
      </span>
      <span className={alert ? `${s.switch} ${s.switchAlert}` : s.switch} aria-hidden="true" />
    </button>
  )
}
