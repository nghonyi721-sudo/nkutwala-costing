import { useEffect, useState } from 'react'
import { supabase, isSupabaseConfigured } from './lib/supabaseClient'
import LoginPage from './pages/LoginPage'
import HomePage from './pages/HomePage'
import AppHeader from './components/AppHeader'
import Skeleton from './components/Skeleton'
import './App.css'

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
      <>
        <AppHeader />
        <main className="app">
          <p className="status warn">
            Supabase: not configured yet - add your keys to the .env file
          </p>
        </main>
      </>
    )
  }

  if (session === undefined) {
    return (
      <>
        <AppHeader />
        <main className="app">
          <Skeleton rows={2} />
        </main>
      </>
    )
  }

  // Logged in: HomePage draws the full app shell (header, user bar, nav).
  if (session) return <HomePage user={session.user} />

  // Logged out: the login screen has its own brand panel.
  return <LoginPage />
}

export default App
