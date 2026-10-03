import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { isOwnerOrAdmin } from '../lib/labels'
import AppShell from '../components/AppShell'
import ProjectsPage from './admin/ProjectsPage'
import EmployeesPage from './admin/EmployeesPage'
import EquipmentPage from './admin/EquipmentPage'
import ReportsPage from './admin/ReportsPage'
import MyReportsPage from './reports/MyReportsPage'

// The logged-in app: loads this user's own name and role (nothing else),
// then shows the app shell with the nav and screens for their role.
function HomePage({ user }) {
  // undefined = loading, null = no profile row, object = loaded
  const [profile, setProfile] = useState(undefined)
  const [error, setError] = useState('')
  // 'home' | 'projects' | 'employees' | 'equipment' | 'reports'
  // | 'new-report' | 'my-reports'
  // 'home' = not chosen yet (the role's landing screen is shown)
  const [screen, setScreen] = useState('home')
  const [visit, setVisit] = useState(0)

  useEffect(() => {
    let cancelled = false

    supabase
      .from('profiles')
      .select('full_name, role')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data, error: loadError }) => {
        if (cancelled) return
        if (loadError) {
          setError('Could not load your profile. Check your signal and try again.')
        } else {
          setProfile(data)
        }
      })

    return () => {
      cancelled = true
    }
  }, [user.id])

  // Hiding screens from site managers is only tidiness - the database refuses
  // them anyway (see the RLS policies and scripts/rls-attack-test.mjs).
  const isAdmin = Boolean(profile) && isOwnerOrAdmin(profile.role)
  const isSiteManager = profile?.role === 'site_manager'

  // Until a nav tab is tapped: owners land on Reports, site managers on My reports.
  let current = screen
  if (current === 'home') current = isAdmin ? 'reports' : isSiteManager ? 'my-reports' : 'home'

  // Tapping a tab always starts that section fresh at its main list.
  function navigate(next) {
    setScreen(next)
    setVisit((count) => count + 1)
  }
  const pageKey = `${current}-${visit}`

  let page = null
  if (isAdmin && current === 'reports') page = <ReportsPage key={pageKey} />
  if (isAdmin && current === 'projects') page = <ProjectsPage key={pageKey} />
  if (isAdmin && current === 'employees') page = <EmployeesPage key={pageKey} />
  if (isAdmin && current === 'equipment') page = <EquipmentPage key={pageKey} />
  if (isSiteManager && (current === 'new-report' || current === 'my-reports')) {
    page = <MyReportsPage key={pageKey} user={user} startNew={current === 'new-report'} />
  }

  return (
    <AppShell
      profile={profile}
      screen={current}
      onNavigate={navigate}
      onLogout={() => supabase.auth.signOut()}
    >
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {!error && profile === undefined && <p className="loading">Loading…</p>}

      {!error && profile === null && (
        <p className="error" role="alert">
          Your account has no profile yet - ask the administrator.
        </p>
      )}

      {page}
    </AppShell>
  )
}

export default HomePage
