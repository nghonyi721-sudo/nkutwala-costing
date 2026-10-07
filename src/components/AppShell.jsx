import { useMemo, useRef, useState } from 'react'
import { ROLE_LABELS, isOwnerOrAdmin } from '../lib/labels'
import ConfirmSheet from './ConfirmSheet'
import {
  ChartBarIcon,
  ClipboardTextIcon,
  DotsThreeOutlineIcon,
  MapPinIcon,
  PlusCircleIcon,
  ReceiptIcon,
  SignOutIcon,
  UserCircleIcon,
} from './icons'
import { Row } from './Row'
import Sheet, { SheetGroup } from './Sheet'
import { ShellContext } from './shellContext'
import s from './AppShell.module.css'

// Phones: five tabs at most (like iOS); Employees and Equipment sit under More.
const OWNER_TABS = [
  { key: 'dashboard', label: 'Dashboard', Icon: ChartBarIcon },
  { key: 'reports', label: 'Reports', Icon: ClipboardTextIcon },
  { key: 'receipts', label: 'Receipts', Icon: ReceiptIcon },
  { key: 'projects', label: 'Projects', Icon: MapPinIcon },
  { key: 'more', label: 'More', Icon: DotsThreeOutlineIcon },
]

// Wide screens have room for every section in the top bar.
const OWNER_DESKTOP_TABS = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'reports', label: 'Reports' },
  { key: 'receipts', label: 'Receipts' },
  { key: 'projects', label: 'Projects' },
  { key: 'employees', label: 'Employees' },
  { key: 'equipment', label: 'Equipment' },
  { key: 'pay', label: 'Pay runs' },
  { key: 'exports', label: 'Exports' },
]

// Screens reached through More keep the More tab lit.
const TAB_OF_SCREEN = { employees: 'more', equipment: 'more', pay: 'more', exports: 'more' }

const SITE_MANAGER_TABS = [
  { key: 'my-reports', label: 'My reports', Icon: ClipboardTextIcon },
  { key: 'new-report', label: 'New report', Icon: PlusCircleIcon },
  { key: 'receipts', label: 'Receipts', Icon: ReceiptIcon },
]

// The frame around every logged-in screen. Each screen draws its own
// navigation bar (see Page/NavBar); the shell provides:
// - the iOS tab bar at the bottom on phones (hidden while a pushed screen
//   such as a form is open; wide screens show the tabs in the nav bar)
// - the Account sheet, with a confirmed Log out
//   badges: a red count on a tab, e.g. { receipts: 3 } receipts waiting
// Hiding tabs is only tidiness - the database decides who sees what.
function AppShell({ profile, screen, onNavigate, onLogout, badges = {}, children }) {
  const [pushedScreens, setPushedScreens] = useState(0)
  const pushedRef = useRef(0)
  const [accountOpen, setAccountOpen] = useState(false)
  const [confirmingLogout, setConfirmingLogout] = useState(false)

  const pushApi = useMemo(
    () => ({
      push: () => {
        pushedRef.current += 1
        setPushedScreens((count) => count + 1)
      },
      pop: () => {
        pushedRef.current -= 1
        setPushedScreens((count) => count - 1)
      },
      isReturning: () => pushedRef.current > 0,
    }),
    [],
  )

  let roleTabs = []
  let roleDesktopTabs = []
  if (profile && isOwnerOrAdmin(profile.role)) {
    roleTabs = OWNER_TABS
    roleDesktopTabs = OWNER_DESKTOP_TABS
  } else if (profile?.role === 'site_manager') {
    roleTabs = SITE_MANAGER_TABS
    roleDesktopTabs = SITE_MANAGER_TABS
  }
  const withBadges = (list) => list.map((tab) => ({ ...tab, badge: badges[tab.key] ?? 0 }))
  const tabs = withBadges(roleTabs)
  const desktopTabs = withBadges(roleDesktopTabs)
  const currentTab = TAB_OF_SCREEN[screen] ?? screen
  const showTabBar = tabs.length > 0 && pushedScreens === 0

  const shell = {
    ...pushApi,
    tabs,
    desktopTabs,
    screen,
    onNavigate,
    profile,
    openAccount: () => setAccountOpen(true),
  }

  return (
    <ShellContext.Provider value={shell}>
      <main className={showTabBar ? s.mainWithTabs : undefined}>{children}</main>

      {showTabBar && (
        <nav className={s.tabBar} aria-label="Main">
          {tabs.map(({ key, label, Icon, badge }) => {
            const current = currentTab === key
            return (
              <button
                key={key}
                type="button"
                className={s.tab}
                aria-current={current ? 'page' : undefined}
                aria-label={badge > 0 ? `${label}, ${badge} waiting` : undefined}
                onClick={() => onNavigate(key)}
              >
                <span className={s.tabIcon}>
                  <Icon size={27} weight={current ? 'fill' : 'regular'} aria-hidden="true" />
                  {badge > 0 && (
                    <span className={s.badge} aria-hidden="true">
                      {badge > 99 ? '99+' : badge}
                    </span>
                  )}
                </span>
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
              iconTone="grey"
              title={profile.full_name}
              subtitle={ROLE_LABELS[profile.role] ?? profile.role}
            />
          </SheetGroup>
          <SheetGroup>
            <Row
              icon={SignOutIcon}
              title="Log out"
              tone="danger"
              onClick={() => setConfirmingLogout(true)}
            />
          </SheetGroup>
        </Sheet>
      )}

      {confirmingLogout && (
        <ConfirmSheet
          title="Log out?"
          message="You'll need your email and password to log in again."
          actionLabel="Log out"
          destructive
          onConfirm={onLogout}
          onCancel={() => setConfirmingLogout(false)}
        />
      )}
    </ShellContext.Provider>
  )
}

export default AppShell
