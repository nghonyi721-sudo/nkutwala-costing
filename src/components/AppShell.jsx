import { useMemo, useState } from 'react'
import { ROLE_LABELS, isOwnerOrAdmin } from '../lib/labels'
import {
  BulldozerIcon,
  ClipboardTextIcon,
  MapPinIcon,
  PlusCircleIcon,
  SignOutIcon,
  UserCircleIcon,
  UsersThreeIcon,
} from './icons'
import BrandMark from './BrandMark'
import Logo from './Logo'
import { Row } from './Row'
import Sheet, { SheetGroup } from './Sheet'
import { ShellContext } from './shellContext'
import s from './AppShell.module.css'

const OWNER_TABS = [
  { key: 'reports', label: 'Reports', Icon: ClipboardTextIcon },
  { key: 'projects', label: 'Projects', Icon: MapPinIcon },
  { key: 'employees', label: 'Employees', Icon: UsersThreeIcon },
  { key: 'equipment', label: 'Equipment', Icon: BulldozerIcon },
]

const SITE_MANAGER_TABS = [
  { key: 'my-reports', label: 'My reports', Icon: ClipboardTextIcon },
  { key: 'new-report', label: 'New report', Icon: PlusCircleIcon },
]

function initials(name = '') {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('')
}

// The frame around every logged-in screen:
// - white top bar: logo, (wide screens) the tabs, and an account button
// - phones: a tab bar at the bottom, hidden while a form is open
// - the Account sheet with name, role and Log out
// Hiding tabs is only tidiness - the database decides who sees what.
function AppShell({ profile, screen, onNavigate, onLogout, children }) {
  const [pushedScreens, setPushedScreens] = useState(0)
  const [accountOpen, setAccountOpen] = useState(false)
  const shell = useMemo(
    () => ({
      push: () => setPushedScreens((count) => count + 1),
      pop: () => setPushedScreens((count) => count - 1),
    }),
    [],
  )

  let tabs = []
  if (profile && isOwnerOrAdmin(profile.role)) tabs = OWNER_TABS
  else if (profile?.role === 'site_manager') tabs = SITE_MANAGER_TABS
  const showTabBar = tabs.length > 0 && pushedScreens === 0

  return (
    <ShellContext.Provider value={shell}>
      <header className={s.topBar}>
        <div className={s.topInner}>
          <Logo width={104} />

          {tabs.length > 0 && (
            <nav className={s.topNav} aria-label="Main">
              {tabs.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  className={s.topTab}
                  aria-current={screen === key ? 'page' : undefined}
                  onClick={() => onNavigate(key)}
                >
                  {label}
                  {screen === key && <BrandMark size="sm" className={s.topTabMark} />}
                </button>
              ))}
            </nav>
          )}

          <button
            type="button"
            className={s.account}
            aria-label="Account"
            disabled={!profile}
            onClick={() => setAccountOpen(true)}
          >
            {/* A black dot inside a blue ring - the dot in the logo's cog */}
            <span className={s.accountDot}>{profile ? initials(profile.full_name) : ''}</span>
          </button>
        </div>
      </header>

      <main className={showTabBar ? s.mainWithTabs : s.main}>{children}</main>

      {showTabBar && (
        <nav className={s.tabBar} aria-label="Main">
          {tabs.map(({ key, label, Icon }) => {
            const current = screen === key
            return (
              <button
                key={key}
                type="button"
                className={s.tab}
                aria-current={current ? 'page' : undefined}
                onClick={() => onNavigate(key)}
              >
                {current && <BrandMark size="sm" className={s.tabMark} />}
                <Icon size={26} weight={current ? 'fill' : 'regular'} aria-hidden="true" />
                <span>{label}</span>
              </button>
            )
          })}
        </nav>
      )}

      {accountOpen && profile && (
        <Sheet title="Account" onClose={() => setAccountOpen(false)}>
          <SheetGroup>
            <Row
              icon={UserCircleIcon}
              title={profile.full_name}
              subtitle={ROLE_LABELS[profile.role] ?? profile.role}
            />
          </SheetGroup>
          <SheetGroup>
            <Row icon={SignOutIcon} title="Log out" tone="danger" onClick={onLogout} />
          </SheetGroup>
        </Sheet>
      )}
    </ShellContext.Provider>
  )
}

export default AppShell
