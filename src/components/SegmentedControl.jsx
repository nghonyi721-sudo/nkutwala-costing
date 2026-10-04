import s from './SegmentedControl.module.css'

// Pick one of two or three options, e.g. Own / Rented.
// options is an object of { value: label }.
function SegmentedControl({ label, options, value, onChange, disabled }) {
  return (
    <div className={s.control} role="radiogroup" aria-label={label}>
      {Object.entries(options).map(([optionValue, optionLabel]) => (
        <button
          key={optionValue}
          type="button"
          role="radio"
          aria-checked={value === optionValue}
          className={s.option}
          disabled={disabled}
          onClick={() => onChange(optionValue)}
        >
          {optionLabel}
        </button>
      ))}
    </div>
  )
}

export default SegmentedControl
