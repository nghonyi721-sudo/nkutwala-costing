import { useEffect, useState } from 'react'
import { supabase, isSupabaseConfigured } from './lib/supabaseClient'
import LoginPage from './pages/LoginPage'
import HomePage from './pages/HomePage'
import BrandBackdrop from './components/BrandBackdrop'
import Logo from './components/Logo'
import Notice from './components/Notice'
import Skeleton from './components/Skeleton'
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

  if (!isSupabaseConfigured) {
    return (
      <div className={s.stage}>
        <BrandBackdrop />
        <div className={s.card}>
          <Logo width={120} />
        </div>
        <Notice tone="error">Supabase: not configured yet - add your keys to the .env file</Notice>
      </div>
    )
  }

  if (session === undefined) {
    return (
      <div className={s.stage}>
        <BrandBackdrop />
        <div className={s.card}>
          <Logo width={120} />
        </div>
        <Skeleton rows={2} />
      </div>
    )
  }

  // Logged in: HomePage draws the app shell (top bar, tabs, screens).
  if (session) return <HomePage user={session.user} />

  // Logged out.
  return <LoginPage />
}

export default App
