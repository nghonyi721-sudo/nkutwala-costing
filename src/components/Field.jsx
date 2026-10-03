const NUMERIC_TYPES = ['date', 'time', 'number']

// A label with its input (or a textarea when multiline). 48px tall, 16px
// text so iPhones don't zoom in. Dates, times and numbers use the mono font.
function Field({ id, label, multiline = false, className = '', ...inputProps }) {
  const Control = multiline ? 'textarea' : 'input'
  const isNumeric = NUMERIC_TYPES.includes(inputProps.type)

  return (
    <div className={['field', className].filter(Boolean).join(' ')}>
      <label htmlFor={id}>{label}</label>
      <Control id={id} className={isNumeric ? 'num' : undefined} {...inputProps} />
    </div>
  )
}

export default Field
