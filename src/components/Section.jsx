import s from './Section.module.css'

// An Apple "inset grouped" section: a small grey header, a white rounded
// group of rows, and an optional footer note.
//   action: { label, onClick } - a small text button in the header (e.g. "Edit")
//   plain:  children sit on the background instead of in a white group
//           (for segmented controls, buttons, text areas)
function Section({ title, action, footer, plain = false, children }) {
  return (
    <section className={s.section}>
      {(title || action) && (
        <div className={s.header}>
          {title && <h2 className={s.title}>{title}</h2>}
          {action && (
            <button type="button" className={s.action} onClick={action.onClick}>
              {action.label}
            </button>
          )}
        </div>
      )}
      <div className={plain ? s.plain : s.group}>{children}</div>
      {footer && <p className={s.footer}>{footer}</p>}
    </section>
  )
}

export default Section
