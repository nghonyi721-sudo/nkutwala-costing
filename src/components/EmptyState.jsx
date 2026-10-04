import s from './EmptyState.module.css'

// "Nothing here yet", with the next step (an optional button).
function EmptyState({ icon: Icon, title, text, action }) {
  return (
    <div className={s.empty}>
      {Icon && <Icon className={s.icon} size={40} aria-hidden="true" />}
      <p className={s.title}>{title}</p>
      {text && <p className={s.text}>{text}</p>}
      {action && <div className={s.action}>{action}</div>}
    </div>
  )
}

export default EmptyState
