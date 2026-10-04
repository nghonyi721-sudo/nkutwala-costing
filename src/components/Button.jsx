import Spinner from './Spinner'
import s from './Button.module.css'

// Apple-style buttons.
//   variant: 'primary'   - filled with the accent colour (the main action)
//            'secondary' - tinted: light accent background, accent text
//            'danger'    - filled red (destructive actions only)
//            'plain'     - accent text only (e.g. "Add" in the nav bar)
//   icon:    optional icon before the label
//   busy:    shows Apple's activity indicator and stops further taps
// Full width unless inline. At least 48px tall (50 for full-width buttons).
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
        <Spinner size={18} />
      ) : (
        Icon && <Icon size={variant === 'plain' ? 24 : 20} weight="bold" aria-hidden="true" />
      )}
      {children}
    </button>
  )
}

export default Button
