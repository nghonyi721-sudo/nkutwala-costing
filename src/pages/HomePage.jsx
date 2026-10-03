import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

const ROLE_LABELS = {
  system_admin: 'System admin',
  owner: 'Owner',
  site_manager: 'Site manager',
}

// Shows who is logged in. Only asks the server for this user's own
// name and role - nothing else.
function HomePage({ user }) {
  // undefined = loading, null = no profile row, object = loaded
  const [profile, setProfile] = useState(undefined)
  const [error, setError] = useState('')

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
