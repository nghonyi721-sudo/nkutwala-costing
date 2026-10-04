import s from './EmptyState.module.css'

// "Nothing here yet", Apple's content-unavailable style: a large grey symbol,
// a title, a short explanation and one next step.
function EmptyState({ icon: Icon, title, text, action }) {
  return (
    <div className={s.empty}>
      {Icon && <Icon className={s.icon} size={56} aria-hidden="true" />}
      <p className={s.title}>{title}</p>
      {text && <p className={s.text}>{text}</p>}
      {action && <div className={s.action}>{action}</div>}
    </div>
  )
}

export default EmptyState
