import { useEffect, useState } from 'react'
import { onScrollLockChange, scrollLockCount } from './scrollLock'

const read = () => `lock ${scrollLockCount()} · overflow ${getComputedStyle(document.body).overflow}`

// TEMPORARY, DEVELOPMENT ONLY (npm run dev) - never in the built app: a small
// corner tag showing the scroll lock count and the body's overflow, to watch
// while testing popups. Taps go straight through it. Red "STUCK" = locked with
// no popup on screen (the bug).
function ScrollLockBadge() {
  const [text, setText] = useState(read)

  useEffect(() => {
    const update = () => setText(read())
    const stop = onScrollLockChange(update)
    // Also catches anything else changing the body's style.
    const timer = window.setInterval(update, 500)
    return () => {
      stop()
      window.clearInterval(timer)
    }
  }, [])

  const stuck = scrollLockCount() > 0 && !document.querySelector('[role="dialog"], [role="alertdialog"]')
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        left: 8,
        bottom: 'calc(env(safe-area-inset-bottom) + 64px)',
        zIndex: 2147483647,
        pointerEvents: 'none',
        padding: '3px 8px',
        borderRadius: 8,
        font: '600 12px/1.4 ui-monospace, monospace',
        color: '#fff',
        background: stuck ? '#c20116' : 'rgba(0, 0, 0, 0.6)',
      }}
    >
      {text}
      {stuck ? ' · STUCK' : ''}
    </div>
  )
}

export default ScrollLockBadge
