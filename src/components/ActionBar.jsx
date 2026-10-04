import s from './ActionBar.module.css'

// A bottom toolbar on form screens, within thumb reach: an optional message
// line, then the buttons side by side.
//   tone: 'info' or 'error' for the message
function ActionBar({ message, tone = 'info', children }) {
  return (
    <div className={s.bar}>
      <div className={s.inner}>
        {message && (
          <div
            className={tone === 'error' ? s.error : s.message}
            role={tone === 'error' ? 'alert' : 'status'}
          >
            {message}
          </div>
        )}
        <div className={s.buttons}>{children}</div>
      </div>
    </div>
  )
}

export default ActionBar
