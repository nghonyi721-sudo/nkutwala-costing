import s from './TextAreaGroup.module.css'

// Multi-line text in its own white group (e.g. the day's activities).
// label is read out by screen readers; show a visible title with <Section>.
function TextAreaGroup({ label, ...props }) {
  return (
    <div className={s.group}>
      <textarea className={s.textarea} aria-label={label} rows={5} {...props} />
    </div>
  )
}

export default TextAreaGroup
