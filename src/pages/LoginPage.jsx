import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import Button from '../components/Button'
import Logo from '../components/Logo'
import s from './LoginPage.module.css'

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
    <form className={s.screen} onSubmit={handleSubmit}>
      {/* The logo needs white, so it sits on a white card. */}
      <div className={s.stage}>
        <div className={s.card}>
          <Logo width={120} />
          <p className={s.product}>Site Costing</p>
          <p className={s.tagline}>Daily activity reports and job costing</p>
        </div>
      </div>

      {/* The form sits at the bottom, within thumb reach. */}
      <div className={s.sheet}>
        <div>
          <h1 className={s.title}>Log in</h1>
          <p className={s.lead}>Use the account the office set up for you.</p>
        </div>

        <div className={s.fields}>
          <label className={s.fieldRow}>
            <span className={s.fieldLabel}>Email</span>
            <input
              className={s.input}
              type="email"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              placeholder="name@example.co.za"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className={s.fieldRow}>
            <span className={s.fieldLabel}>Password</span>
            <input
              className={s.input}
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
        </div>

        {error && (
          <p className={s.error} role="alert">
            {error}
          </p>
        )}

        <Button type="submit" disabled={busy}>
          {busy ? 'Logging in…' : 'Log in'}
        </Button>
        <p className={s.note}>Forgot your password? Ask the office.</p>
      </div>
    </form>
  )
}

export default LoginPage
