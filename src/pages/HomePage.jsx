import { lazy, Suspense, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { isOwnerOrAdmin } from '../lib/labels'
import AppShell from '../components/AppShell'
import Notice from '../components/Notice'
import Page from '../components/Page'
import Skeleton from '../components/Skeleton'
import MorePage from './admin/MorePage'
import ProjectsPage from './admin/ProjectsPage'
import EmployeesPage from './admin/EmployeesPage'
import EquipmentPage from './admin/EquipmentPage'
import ReceiptsPage from './admin/ReceiptsPage'
import ReportsPage from './admin/ReportsPage'
import MyReceiptsPage from './receipts/MyReceiptsPage'
import MyReportsPage from './reports/MyReportsPage'

// The dashboard (and its chart library) is only ever downloaded for owners
// and admins - site managers never load its code.
const DashboardPage = lazy(() => import('./admin/DashboardPage'))

const DASHBOARD_PATH = '/dashboard'

// The logged-in app: loads this user's own name and role (nothing else),
// then shows the app shell with the nav and screens for their role.
function HomePage({ user }) {
  // undefined = loading, null = no profile row, object = loaded
  const [profile, setProfile] = useState(undefined)
  const [error, setError] = useState('')
  // 'home' | 'dashboard' | 'projects' | 'employees' | 'equipment' | 'more'
  // | 'reports' | 'receipts' | 'new-report' | 'my-reports'
  // 'home' = not chosen yet (the role's landing screen is shown).
  // Opening the app at /dashboard asks for the dashboard straight away.
  const [screen, setScreen] = useState(() => (window.location.pathname === DASHBOARD_PATH ? 'dashboard' : 'home'))
  const [visit, setVisit] = useState(0)
  // Owners/admins: receipts waiting for approval (the tab's badge).
  const [pendingReceipts, setPendingReceipts] = useState(0)
  const [receiptChanges, setReceiptChanges] = useState(0)

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

  // Counted again on every tab tap and after every approve/reject/reverse.
  useEffect(() => {
    if (!isAdmin) return undefined
    let cancelled = false

    supabase
      .from('receipts')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'submitted')
      .then(({ count }) => {
        if (!cancelled) setPendingReceipts(count ?? 0)
      })

    return () => {
      cancelled = true
    }
  }, [isAdmin, visit, receiptChanges])

  // Until a nav tab is tapped: owners land on the Dashboard, site managers on
  // My reports.
  let current = screen
  if (current === 'home') current = isAdmin ? 'dashboard' : isSiteManager ? 'my-reports' : 'home'

  // The address bar shows /dashboard while on the dashboard, / otherwise.
  useEffect(() => {
    if (!profile) return
    const path = current === 'dashboard' ? DASHBOARD_PATH : '/'
    if (window.location.pathname !== path) window.history.replaceState(null, '', path)
  }, [current, profile])

  // Tapping a tab always starts that section fresh at its main list.
  function navigate(next) {
    setScreen(next)
    setVisit((count) => count + 1)
  }
  const pageKey = `${current}-${visit}`

  let page = null
  if (isAdmin && current === 'dashboard') {
    page = (
      <Suspense
        fallback={
          <Page title="Dashboard">
            <Skeleton rows={4} />
          </Page>
        }
      >
        <DashboardPage key={pageKey} onNavigate={navigate} />
      </Suspense>
    )
  }
  // Anyone else who opens /dashboard: a plain page, and no money requests.
  if (profile && !isAdmin && current === 'dashboard') {
    page = (
      <Page title="Not available">
        <Notice tone="locked">The dashboard is for owners only.</Notice>
      </Page>
    )
  }
  if (isAdmin && current === 'more') page = <MorePage key={pageKey} onNavigate={navigate} />
  if (isAdmin && current === 'reports') page = <ReportsPage key={pageKey} />
  if (isAdmin && current === 'receipts') {
    page = (
      <ReceiptsPage
        key={pageKey}
        user={user}
        role={profile.role}
        onChanged={() => setReceiptChanges((count) => count + 1)}
      />
    )
  }
  if (isAdmin && current === 'projects') page = <ProjectsPage key={pageKey} />
  if (isAdmin && current === 'employees') page = <EmployeesPage key={pageKey} />
  if (isAdmin && current === 'equipment') page = <EquipmentPage key={pageKey} />
  if (isSiteManager && (current === 'new-report' || current === 'my-reports')) {
    page = (
      <MyReportsPage
        key={pageKey}
        user={user}
        startNew={current === 'new-report'}
        onShowList={() => navigate('my-reports')}
      />
    )
  }
  if (isSiteManager && current === 'receipts') page = <MyReceiptsPage key={pageKey} user={user} />

  return (
    <AppShell
      profile={profile}
      screen={current}
      onNavigate={navigate}
      onLogout={() => supabase.auth.signOut()}
      badges={{ receipts: pendingReceipts }}
    >
      {error && (
        <Page title="Can't load your account">
          <Notice tone="error">{error}</Notice>
        </Page>
      )}

      {!error && profile === undefined && (
        <Page>
          <Skeleton rows={2} />
        </Page>
      )}

      {!error && profile === null && (
        <Page title="No profile yet">
          <Notice tone="error">Your account has no profile yet - ask the administrator.</Notice>
        </Page>
      )}

      {page}
    </AppShell>
  )
}

export default HomePage
