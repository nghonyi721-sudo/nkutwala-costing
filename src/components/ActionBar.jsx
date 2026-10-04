import s from './ActionBar.module.css'

// The bar pinned to the bottom of a form screen, within thumb reach: an
// optional message line, then the buttons side by side.
//   tone: 'info' (blue message), 'error' (red message)
function ActionBar({ message, tone = 'info', children }) {
  return (
    <div className={s.bar}>
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
  )
}

export default ActionBar
