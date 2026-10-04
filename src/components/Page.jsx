import { useEffect, useRef, useState } from 'react'
import NavBar from './NavBar'
import { useShell, usePushedScreen } from './shellContext'
import s from './Page.module.css'

// A screen, iOS-style: navigation bar, a large title that hands over to a
// small title in the bar as you scroll, the content, and an optional footer
// toolbar (an <ActionBar>).
//   onBack:   makes it a "pushed" screen - "‹ backLabel" in the bar, the tab
//             bar hides, and it slides in from the right
//   action:   the screen's action in the bar (e.g. an Add button)
//   onSubmit: the whole screen is a form, so a submit button saves it
function Page({ title, subtitle, onBack, backLabel = 'Back', action, footer, onSubmit, children }) {
  const shell = useShell()
  const pushed = Boolean(onBack)
  usePushedScreen(pushed)

  // How it arrives: pushed screens slide in from the right; a list we're
  // returning to slides back in from the left. Tab switches don't animate.
  const [arrival] = useState(() => (pushed ? 'push' : shell?.isReturning() ? 'pop' : null))

  // Large title collapses into the bar once it scrolls under it.
  const [collapsed, setCollapsed] = useState(false)
  const sentinel = useRef(null)
  useEffect(() => {
    const element = sentinel.current
    if (!element || !('IntersectionObserver' in window)) return undefined
    const observer = new IntersectionObserver(([entry]) => setCollapsed(!entry.isIntersecting), {
      rootMargin: '-60px 0px 0px 0px',
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const Root = onSubmit ? 'form' : 'div'

  return (
    <Root className={arrival ? `${s.page} ${s[arrival]}` : s.page} onSubmit={onSubmit}>
      <NavBar title={title} collapsed={collapsed} onBack={onBack} backLabel={backLabel} action={action} />
      <div className={s.content}>
        {title && (
          <header className={s.header}>
            <h1 className={s.largeTitle}>{title}</h1>
            {subtitle && <p className={s.subtitle}>{subtitle}</p>}
          </header>
        )}
        <div ref={sentinel} className={s.sentinel} aria-hidden="true" />
        {children}
      </div>
      {footer}
    </Root>
  )
}

export default Page
