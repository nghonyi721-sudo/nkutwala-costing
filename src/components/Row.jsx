import { CaretRightIcon } from './icons'
import s from './Row.module.css'

// List rows inside a <Section>, like the iPhone's Settings app.
//
// Icons sit on small coloured tiles (white symbol on a rounded square):
//   iconTone: 'blue' (accent, default), 'red' (warnings), 'grey' (neutral)
// Rows with tone 'accent' (e.g. "Add person") or 'danger' (e.g. "Log out")
// show the icon on its own, in that colour, with no tile.

const TONES = { blue: s.tileBlue, red: s.tileRed, grey: s.tileGrey }

function RowIcon({ icon: Icon, iconTone = 'blue', plain }) {
  if (!Icon) return null
  if (plain) return <Icon className={s.plainIcon} size={26} weight="fill" aria-hidden="true" />
  return (
    <span className={`${s.tile} ${TONES[iconTone] ?? s.tileBlue}`} aria-hidden="true">
      <Icon size={18} weight="fill" />
    </span>
  )
}

function rowClass(hasIcon, extra) {
  return [s.row, hasIcon ? s.withIcon : '', extra].filter(Boolean).join(' ')
}

// title, optional subtitle, something on the right (trailing), a chevron.
// Becomes a button when onClick is given.
//   tone: 'accent' (blue title), 'danger' (red title), 'strong' (bold)
//   leading: something before the icon (e.g. a remove button)
export function Row({
  icon,
  iconTone,
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
  const plainIcon = tone === 'accent' || tone === 'danger'
  return (
    <Tag
      className={rowClass(icon, tone ? s[tone] : '')}
      onClick={onClick}
      type={onClick ? 'button' : undefined}
      {...props}
    >
      {leading}
      <RowIcon icon={icon} iconTone={iconTone} plain={plainIcon} />
      <span className={s.main}>
        <span className={s.title}>{title}</span>
        {subtitle && <span className={mono ? `${s.subtitle} num` : s.subtitle}>{subtitle}</span>}
      </span>
      {trailing !== undefined && trailing !== null && <span className={s.trailing}>{trailing}</span>}
      {chevron && <CaretRightIcon className={s.chevron} size={15} weight="bold" aria-hidden="true" />}
    </Tag>
  )
}

// A label on the left and a text/number input on the right.
export function FieldRow({ icon, iconTone, label, suffix, inputWidth, ...inputProps }) {
  return (
    <label className={rowClass(icon)}>
      <RowIcon icon={icon} iconTone={iconTone} />
      <span className={s.main}>
        <span className={s.title}>{label}</span>
      </span>
      <input className={s.input} style={inputWidth ? { width: inputWidth } : undefined} {...inputProps} />
      {suffix && <span className={s.suffix}>{suffix}</span>}
    </label>
  )
}

// An iOS switch row; the whole row is the tap target.
//   alert: "on" is a warning (e.g. near miss) - red tile and red switch.
export function SwitchRow({ icon, title, subtitle, checked, onChange, alert = false, ...props }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={rowClass(icon)}
      onClick={() => onChange(!checked)}
      {...props}
    >
      <RowIcon icon={icon} iconTone={alert ? 'red' : 'blue'} />
      <span className={s.main}>
        <span className={s.title}>{title}</span>
        {subtitle && <span className={s.subtitle}>{subtitle}</span>}
      </span>
      <span className={alert ? `${s.switch} ${s.switchAlert}` : s.switch} aria-hidden="true" />
    </button>
  )
}
