import { useEffect, useState } from 'react'
import { supabase, isSupabaseConfigured } from './lib/supabaseClient'
import LoginPage from './pages/LoginPage'
import HomePage from './pages/HomePage'
import Logo from './components/Logo'
import Notice from './components/Notice'
import { resetScrollLock } from './components/scrollLock'
import { hideSplash } from './lib/splash'
import s from './App.module.css'

// Before the login page the launch screen stays at least this long, counted
// from when the page started loading.
const LOGIN_SPLASH_MS = 3000

function App() {
  // undefined = still checking, null = logged out, object = logged in
  const [session, setSession] = useState(undefined)

  useEffect(() => {
    if (!supabase) return

    // Pick up a login saved from a previous visit.
    supabase.auth.getSession().then(({ data }) => setSession(data.session))

    // Then keep up to date when the user logs in or out.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
    })
    return () => subscription.unsubscribe()
  }, [])

  // Logging in or out is a new screen: the page always scrolls again.
  const userId = session?.user?.id ?? null
  useEffect(() => {
    resetScrollLock()
  }, [userId])

  // The launch screen (index.html) covers everything until the first screen
  // is ready. Logged out: shown for at least 3 s before the login page. No
  // Supabase keys: hidden now. Logged in: HomePage hides it once the
  // person's role is known (no wait).
  useEffect(() => {
    if (!isSupabaseConfigured) hideSplash()
    else if (session === null) hideSplash({ atLeast: LOGIN_SPLASH_MS })
  }, [session])

  if (!isSupabaseConfigured) {
    return (
      <div className={s.stage}>
        <span className={s.logoTile}>
          <Logo width={120} />
        </span>
        <Notice tone="error">Supabase: not configured yet - add your keys to the .env file</Notice>
      </div>
    )
  }

  // Still reading the saved login: the launch screen is showing.
  if (session === undefined) return null

  // Logged in: HomePage draws the app shell (navigation, tabs, screens).
  if (session) return <HomePage user={session.user} />

  // Logged out.
  return <LoginPage />
}

export default App
