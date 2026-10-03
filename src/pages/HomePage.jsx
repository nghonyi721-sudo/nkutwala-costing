import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { ROLE_LABELS, isOwnerOrAdmin } from '../lib/labels'
import ProjectsPage from './admin/ProjectsPage'
import EmployeesPage from './admin/EmployeesPage'
import EquipmentPage from './admin/EquipmentPage'
import ReportsPage from './admin/ReportsPage'
import MyReportsPage from './reports/MyReportsPage'

// Shows who is logged in. Only asks the server for this user's own
// name and role - nothing else. Owners and admins also get admin buttons.
function HomePage({ user }) {
  // undefined = loading, null = no profile row, object = loaded
  const [profile, setProfile] = useState(undefined)
  const [error, setError] = useState('')
  // 'home' | 'projects' | 'employees' | 'equipment' | 'reports'
  // | 'new-report' | 'my-reports'
  const [screen, setScreen] = useState('home')

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

  // Hiding these from site managers is only tidiness - the database refuses
  // them anyway (see the RLS policies and scripts/rls-attack-test.mjs).
  const isAdmin = Boolean(profile) && isOwnerOrAdmin(profile.role)
  const isSiteManager = profile?.role === 'site_manager'
  const goHome = () => setScreen('home')

  if (isAdmin && screen === 'projects') return <ProjectsPage onBack={goHome} />
  if (isAdmin && screen === 'employees') return <EmployeesPage onBack={goHome} />
  if (isAdmin && screen === 'equipment') return <EquipmentPage onBack={goHome} />
  if (isAdmin && screen === 'reports') return <ReportsPage onBack={goHome} />
  if (isSiteManager && (screen === 'new-report' || screen === 'my-reports')) {
    return <MyReportsPage user={user} startNew={screen === 'new-report'} onBack={goHome} />
  }

  return (
    <div className="card">
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

      {profile && (
        <>
          <p className="label">Logged in as</p>
          <h1 className="name">{profile.full_name}</h1>
          <p className="role">{ROLE_LABELS[profile.role] ?? profile.role}</p>
        </>
      )}

      {isSiteManager && (
        <>
          <button type="button" className="btn-primary" onClick={() => setScreen('new-report')}>
            New daily report
          </button>
          <button type="button" className="btn-primary" onClick={() => setScreen('my-reports')}>
            My reports
          </button>
        </>
      )}

      {isAdmin && (
        <>
          <button type="button" className="btn-primary" onClick={() => setScreen('reports')}>
            Daily reports
          </button>
          <button type="button" className="btn-primary" onClick={() => setScreen('projects')}>
            Projects
          </button>
          <button type="button" className="btn-primary" onClick={() => setScreen('employees')}>
            Employees
          </button>
          <button type="button" className="btn-primary" onClick={() => setScreen('equipment')}>
            Equipment
          </button>
        </>
      )}

      <button
        type="button"
        className="btn-secondary"
        onClick={() => supabase.auth.signOut()}
      >
        Log out
      </button>
    </div>
  )
}

export default HomePage
