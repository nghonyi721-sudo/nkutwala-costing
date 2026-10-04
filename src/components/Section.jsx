import s from './Section.module.css'

// A titled group: small grey caption, a white rounded group holding rows,
// and an optional footer note. Whitespace separates sections.
//   action: { label, onClick } - a small text button by the caption (e.g. "Edit")
//   plain:  children sit on the grey background instead of in a white group
//           (for segmented controls, buttons, notes)
function Section({ title, action, footer, plain = false, children }) {
  return (
    <section className={s.section}>
      {(title || action) && (
        <div className={s.caption}>
          {title && <h2 className={s.captionTitle}>{title}</h2>}
          {action && (
            <button type="button" className={s.captionAction} onClick={action.onClick}>
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
