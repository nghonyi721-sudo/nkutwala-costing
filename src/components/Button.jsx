import { GearSixIcon } from './icons'
import s from './Button.module.css'

// The one button.
//   variant: 'primary' (blue), 'secondary' (grey), 'danger' (red),
//            'plain' (blue text, e.g. "Add" in a page header)
//   icon:    optional Phosphor icon shown before the label
//   busy:    shows the logo's cog turning (e.g. while "Saving…") and
//            stops further taps
// Full width unless inline. Always at least 48px tall.
function Button({
  variant = 'primary',
  icon: Icon,
  inline = false,
  busy = false,
  type = 'button',
  className,
  disabled,
  children,
  ...props
}) {
  const classes = [s.button, s[variant], inline ? s.inline : '', className].filter(Boolean).join(' ')
  return (
    <button
      type={type}
      className={classes}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...props}
    >
      {busy ? (
        <GearSixIcon className={s.spin} size={22} weight="bold" aria-hidden="true" />
      ) : (
        Icon && <Icon size={22} weight={variant === 'plain' ? 'bold' : 'regular'} aria-hidden="true" />
      )}
      {children}
    </button>
  )
}

export default Button
