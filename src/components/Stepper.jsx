import { MinusIcon, PlusIcon } from './icons'
import s from './Stepper.module.css'

// An Apple-style stepper: − | value | + on a grey pill, hairline dividers.
// Kept 48px tall so it works with gloves. The value uses rounded numerals.
//   label: what it changes, for screen readers (e.g. "Sipho hours")
//   unit:  '%' sits tight ("10%"); anything else gets a space ("9.5 h")
function Stepper({ label, value, onChange, step = 0.5, min = 0, max = 24, unit = '', disabled }) {
  const decimals = Number.isInteger(step) ? 0 : 1
  const round = (number) => Math.round(number * 100) / 100
  const change = (delta) => onChange(Math.min(max, Math.max(min, round(value + delta))))

  return (
    <div className={s.stepper} role="group" aria-label={label}>
      <button
        type="button"
        className={s.button}
        aria-label={`Less ${label}`}
        disabled={disabled || value <= min}
        onClick={() => change(-step)}
      >
        <MinusIcon size={18} weight="bold" />
      </button>
      <span className={s.value} aria-live="polite">
        {value.toFixed(decimals)}
        <span className={s.unit}>{unit === '%' ? '%' : unit ? ` ${unit}` : ''}</span>
      </span>
      <button
        type="button"
        className={s.button}
        aria-label={`More ${label}`}
        disabled={disabled || value >= max}
        onClick={() => change(step)}
      >
        <PlusIcon size={18} weight="bold" />
      </button>
    </div>
  )
}

export default Stepper
