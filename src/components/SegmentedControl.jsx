import s from './SegmentedControl.module.css'

// iOS segmented control: a grey track with a white "thumb" that slides to
// the chosen option. options is an object of { value: label }.
function SegmentedControl({ label, options, value, onChange, disabled }) {
  const entries = Object.entries(options)
  const index = entries.findIndex(([optionValue]) => optionValue === value)

  return (
    <div
      className={s.control}
      role="radiogroup"
      aria-label={label}
      style={{ '--count': entries.length, '--index': Math.max(index, 0) }}
    >
      {index >= 0 && <span className={s.thumb} aria-hidden="true" />}
      {entries.map(([optionValue, optionLabel]) => (
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
