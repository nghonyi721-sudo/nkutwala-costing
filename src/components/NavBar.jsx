import { CaretLeftIcon } from './icons'
import Logo from './Logo'
import { useShell } from './shellContext'
import s from './NavBar.module.css'

function initials(name = '') {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('')
}

// The iOS navigation bar at the top of every screen.
//   left:   "‹ Back" (labelled with the previous screen) on pushed screens,
//           the logo on main screens
//   middle: the screen title, once the large title has scrolled away
//           (on wide screens: the main tabs)
//   right:  the screen's action, plus the account button on main screens
// Solid colour (no blur); a hairline appears once content scrolls under it.
function NavBar({ title, collapsed, onBack, backLabel, action }) {
  const shell = useShell()
  const tabs = shell?.desktopTabs ?? shell?.tabs ?? []

  return (
    <header className={collapsed ? `${s.bar} ${s.collapsed}` : s.bar}>
      <div className={s.inner}>
        <div className={s.leading}>
          {onBack ? (
            <button type="button" className={s.back} onClick={onBack}>
              <CaretLeftIcon size={22} weight="bold" aria-hidden="true" />
              {/* Like iOS: once the small title shows, the back label
                  becomes plain "Back" so the title has room. */}
              <span>{collapsed && title && backLabel.length > 4 ? 'Back' : backLabel}</span>
            </button>
          ) : (
            <Logo width={88} />
          )}
        </div>

        <div className={s.center}>
          {tabs.length > 0 && (
            <nav className={s.tabs} aria-label="Main">
              {tabs.map(({ key, label, badge }) => (
                <button
                  key={key}
                  type="button"
                  className={s.tab}
                  aria-current={shell.screen === key ? 'page' : undefined}
                  onClick={() => shell.onNavigate(key)}
                >
                  {label}
                  {badge > 0 && (
                    <span className={s.badge}>
                      <span className="visually-hidden">, </span>
                      {badge > 99 ? '99+' : badge}
                      <span className="visually-hidden"> waiting</span>
                    </span>
                  )}
                </button>
              ))}
            </nav>
          )}
          {title && (
            <span className={s.compactTitle} aria-hidden="true">
              {title}
            </span>
          )}
        </div>

        <div className={s.trailing}>
          {action}
          {!onBack && shell?.profile && (
            <button type="button" className={s.avatar} aria-label="Account" onClick={shell.openAccount}>
              <span className={s.avatarCircle}>{initials(shell.profile.full_name)}</span>
            </button>
          )}
        </div>
      </div>
    </header>
  )
}

export default NavBar
