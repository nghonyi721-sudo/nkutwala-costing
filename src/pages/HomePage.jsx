import { lazy, Suspense, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { isOwnerOrAdmin } from '../lib/labels'
import AppShell from '../components/AppShell'
import LoadError from '../components/LoadError'
import Notice from '../components/Notice'
import Page from '../components/Page'
import Skeleton from '../components/Skeleton'
import { resetScrollLock } from '../components/scrollLock'
// Site-manager screens: part of the app's first download, so they open fast.
import MyReceiptsPage from './receipts/MyReceiptsPage'
import MyReportsPage from './reports/MyReportsPage'

// Owner/admin screens are only downloaded the first time they're opened -
// site managers never load their code (or the chart library).
const DashboardPage = lazy(() => import('./admin/DashboardPage'))
const MorePage = lazy(() => import('./admin/MorePage'))
const ReportsPage = lazy(() => import('./admin/ReportsPage'))
const ReceiptsPage = lazy(() => import('./admin/ReceiptsPage'))
const ProjectsPage = lazy(() => import('./admin/ProjectsPage'))
const EmployeesPage = lazy(() => import('./admin/EmployeesPage'))
const EquipmentPage = lazy(() => import('./admin/EquipmentPage'))
const ExportsPage = lazy(() => import('./admin/ExportsPage'))
const PayRunsPage = lazy(() => import('./admin/pay/PayRunsPage'))
const PayRulesPage = lazy(() => import('./admin/payRules/PayRulesPage'))

// Each screen's title: shown while it downloads, or if it can't.
const TITLES = {
  dashboard: 'Dashboard',
  more: 'More',
  reports: 'Reports',
  receipts: 'Receipts',
  projects: 'Projects',
  employees: 'Employees',
  equipment: 'Equipment',
  exports: 'Exports',
  pay: 'Pay runs',
  'pay-rules': 'Pay rules',
}

const DASHBOARD_PATH = '/dashboard'

// The logged-in app: loads this user's own name and role (nothing else),
// then shows the app shell with the nav and screens for their role.
function HomePage({ user }) {
  // undefined = loading, null = no profile row, object = loaded
  const [profile, setProfile] = useState(undefined)
  const [error, setError] = useState('')
  // 'home' | 'dashboard' | 'projects' | 'employees' | 'equipment' | 'exports' | 'pay'
  // | 'pay-rules' | 'more' | 'reports' | 'receipts' | 'new-report' | 'my-reports'
  // 'home' = not chosen yet (the role's landing screen is shown).
  // Opening the app at /dashboard asks for the dashboard straight away.
  const [screen, setScreen] = useState(() => (window.location.pathname === DASHBOARD_PATH ? 'dashboard' : 'home'))
  const [visit, setVisit] = useState(0)
  // Owners/admins: receipts waiting for approval (the tab's badge).
  const [pendingReceipts, setPendingReceipts] = useState(0)
  const [receiptChanges, setReceiptChanges] = useState(0)
  // Owners/admins: new employees waiting for approval (More / Employees badge).
  const [pendingEmployees, setPendingEmployees] = useState(0)
  const [employeeChanges, setEmployeeChanges] = useState(0)

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

  // Counted again on every tab tap and after every approve/reject.
  useEffect(() => {
    if (!isAdmin) return undefined
    let cancelled = false

    supabase
      .from('employees')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
      .then(({ count }) => {
        if (!cancelled) setPendingEmployees(count ?? 0)
      })

    return () => {
      cancelled = true
    }
  }, [isAdmin, visit, employeeChanges])

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
    // A new screen always scrolls: whatever popup state the old one left.
    resetScrollLock()
    setScreen(next)
    setVisit((count) => count + 1)
  }
  const pageKey = `${current}-${visit}`

  let page = null
  if (isAdmin && current === 'dashboard') page = <DashboardPage key={pageKey} onNavigate={navigate} />
  // Anyone else who opens /dashboard: a plain page, and no money requests.
  if (profile && !isAdmin && current === 'dashboard') {
    page = (
      <Page title="Not available">
        <Notice tone="locked">The dashboard is for owners only.</Notice>
      </Page>
    )
  }
  if (isAdmin && current === 'more') {
    page = <MorePage key={pageKey} pendingEmployees={pendingEmployees} onNavigate={navigate} />
  }
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
  if (isAdmin && current === 'employees') {
    page = <EmployeesPage key={pageKey} onChanged={() => setEmployeeChanges((count) => count + 1)} />
  }
  if (isAdmin && current === 'equipment') page = <EquipmentPage key={pageKey} />
  if (isAdmin && current === 'exports') page = <ExportsPage key={pageKey} />
  if (isAdmin && current === 'pay') page = <PayRunsPage key={pageKey} role={profile.role} />
  if (isAdmin && current === 'pay-rules') page = <PayRulesPage key={pageKey} />
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
      badges={{ receipts: pendingReceipts, more: pendingEmployees, employees: pendingEmployees }}
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

      {/* A screen still downloading: its title and grey rows. One that
          can't download: a message and Try again. */}
      {page && (
        <LoadError key={pageKey} title={TITLES[current]}>
          <Suspense
            fallback={
              <Page title={TITLES[current]}>
                <Skeleton rows={4} />
              </Page>
            }
          >
            {page}
          </Suspense>
        </LoadError>
      )}
    </AppShell>
  )
}

export default HomePage
