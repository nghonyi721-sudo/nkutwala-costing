import { useEffect, useState } from 'react'
import { supabase, isSupabaseConfigured } from './lib/supabaseClient'
import LoginPage from './pages/LoginPage'
import HomePage from './pages/HomePage'
import Logo from './components/Logo'
import Notice from './components/Notice'
import { resetScrollLock } from './components/scrollLock'
import Spinner from './components/Spinner'
import s from './App.module.css'

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

  if (session === undefined) {
    return (
      <div className={s.stage} role="status" aria-label="Loading">
        <span className={s.logoTile}>
          <Logo width={120} />
        </span>
        <Spinner size={24} className={s.spinner} />
      </div>
    )
  }

  // Logged in: HomePage draws the app shell (navigation, tabs, screens).
  if (session) return <HomePage user={session.user} />

  // Logged out.
  return <LoginPage />
}

export default App
