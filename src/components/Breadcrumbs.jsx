import { CaretRightIcon } from './icons'
import s from './Breadcrumbs.module.css'

// Where you are in a drill-down, e.g. Dashboard › R40 stormwater › Labour.
// Tap an earlier step to jump straight back to it; the last step is where
// you are. Wraps onto a second line rather than scrolling sideways.
//   steps: [{ label, onClick }] - the last step has no onClick
function Breadcrumbs({ steps }) {
  return (
    <nav className={s.crumbs} aria-label="Breadcrumb">
      <ol className={s.list}>
        {steps.map((step, index) => (
          <li key={index} className={s.item}>
            {index > 0 && <CaretRightIcon className={s.separator} size={12} weight="bold" aria-hidden="true" />}
            {step.onClick ? (
              <button type="button" className={s.crumb} onClick={step.onClick}>
                {step.label}
              </button>
            ) : (
              <span className={s.current} aria-current="page">
                {step.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}

export default Breadcrumbs
