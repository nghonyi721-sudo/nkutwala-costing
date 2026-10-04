import s from './Button.module.css'

// The one button.
//   variant: 'primary' (blue), 'secondary' (grey), 'danger' (red),
//            'plain' (blue text, e.g. "Add" in a page header)
//   icon:    optional Phosphor icon shown before the label
// Full width unless inline. Always at least 48px tall.
function Button({
  variant = 'primary',
  icon: Icon,
  inline = false,
  type = 'button',
  className,
  children,
  ...props
}) {
  const classes = [s.button, s[variant], inline ? s.inline : '', className].filter(Boolean).join(' ')
  return (
    <button type={type} className={classes} {...props}>
      {Icon && <Icon size={22} weight={variant === 'plain' ? 'bold' : 'regular'} aria-hidden="true" />}
      {children}
    </button>
  )
}

export default Button
