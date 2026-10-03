import { ROLE_LABELS, isOwnerOrAdmin } from '../lib/labels'
import AppHeader from './AppHeader'

const OWNER_NAV = [
  ['reports', 'Reports'],
  ['projects', 'Projects'],
  ['employees', 'Employees'],
  ['equipment', 'Equipment'],
]

const SITE_MANAGER_NAV = [
  ['new-report', 'New report'],
  ['my-reports', 'My reports'],
]

// The frame around every logged-in screen: blue header, black bar with the
// user's name, role and Logout, then the nav for their role.
// Hiding nav items is only tidiness - the database enforces who sees what.
function AppShell({ profile, screen, onNavigate, onLogout, children }) {
  let nav = []
  if (profile && isOwnerOrAdmin(profile.role)) nav = OWNER_NAV
  else if (profile?.role === 'site_manager') nav = SITE_MANAGER_NAV

  return (
    <>
      <AppHeader />

      <div className="user-bar">
        <span className="user-name">{profile?.full_name ?? ''}</span>
        {profile && <span className="user-role">{ROLE_LABELS[profile.role] ?? profile.role}</span>}
        <button type="button" className="btn-logout" onClick={onLogout}>
          Logout
        </button>
      </div>

      {nav.length > 0 && (
        <nav className="nav" aria-label="Main">
          {nav.map(([key, label]) => (
            <button
              key={key}
              type="button"
              className="nav-tab"
              aria-current={screen === key ? 'page' : undefined}
              onClick={() => onNavigate(key)}
            >
              {label}
            </button>
          ))}
        </nav>
      )}

      <main className="app">{children}</main>
    </>
  )
}

export default AppShell
