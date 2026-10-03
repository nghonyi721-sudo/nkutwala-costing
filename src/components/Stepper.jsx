// Big − / + buttons instead of typing a number - works with gloved hands.
function Stepper({ label, value, onChange, step = 0.5, min = 0, max = 24, unit = '' }) {
  const round = (number) => Math.round(number * 100) / 100

  return (
    <div className="stepper">
      {label && <span className="stepper-label">{label}</span>}
      <div className="stepper-controls" role="group" aria-label={label}>
        <button
          type="button"
          className="stepper-btn"
          aria-label={`Less ${label ?? ''}`.trim()}
          disabled={value <= min}
          onClick={() => onChange(Math.max(min, round(value - step)))}
        >
          −
        </button>
        <span className="stepper-value" aria-live="polite">
          {value}
          {unit && ` ${unit}`}
        </span>
        <button
          type="button"
          className="stepper-btn"
          aria-label={`More ${label ?? ''}`.trim()}
          disabled={value >= max}
          onClick={() => onChange(Math.min(max, round(value + step)))}
        >
          +
        </button>
      </div>
    </div>
  )
}

export default Stepper
