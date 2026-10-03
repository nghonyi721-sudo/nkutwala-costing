// The one button. variant: 'primary' (blue), 'secondary' (white, black
// border) or 'danger' (red). Full width by default for one-column phone
// screens; pass inline to size it to its text. Always at least 48px tall.
function Button({ variant = 'primary', inline = false, type = 'button', className = '', ...props }) {
  const classes = ['btn', `btn-${variant}`, inline ? 'btn-inline' : '', className]
    .filter(Boolean)
    .join(' ')
  return <button type={type} className={classes} {...props} />
}

export default Button
