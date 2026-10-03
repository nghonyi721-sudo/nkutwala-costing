import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'

// Email + password login. There is no sign-up: accounts are created by the
// administrator in the Supabase dashboard.
function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    setBusy(true)

    const { error: loginError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })

    setBusy(false)
    if (loginError) {
      setError(
        loginError.message === 'Invalid login credentials'
          ? 'Wrong email or password.'
          : 'Could not log in. Check your signal and try again.',
      )
    }
    // On success App.jsx notices the new session and shows the home page.
  }

  return (
    <form className="card" onSubmit={handleSubmit}>
      <h1>Nkutwala Site Costing</h1>

      <label htmlFor="email">Email</label>
      <input
        id="email"
        type="email"
        inputMode="email"
        autoComplete="username"
        autoCapitalize="none"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />

      <label htmlFor="password">Password</label>
      <input
        id="password"
        type="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <button type="submit" className="btn-primary" disabled={busy}>
        {busy ? 'Logging in…' : 'Log in'}
      </button>
    </form>
  )
}

export default LoginPage
