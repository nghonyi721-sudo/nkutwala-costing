import { MinusIcon, PlusIcon } from './icons'
import s from './Stepper.module.css'

// The grey − value + pill used for hours, rain and delay. Buttons are 48px
// and the icons bold so they're easy to hit and see outdoors.
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
        <MinusIcon size={20} weight="bold" />
      </button>
      <span className={s.value} aria-live="polite">
        {value.toFixed(decimals)}
        {unit === '%' ? '%' : unit ? ` ${unit}` : ''}
      </span>
      <button
        type="button"
        className={s.button}
        aria-label={`More ${label}`}
        disabled={disabled || value >= max}
        onClick={() => change(step)}
      >
        <PlusIcon size={20} weight="bold" />
      </button>
    </div>
  )
}

export default Stepper
