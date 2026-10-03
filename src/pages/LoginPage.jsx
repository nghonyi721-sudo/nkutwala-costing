import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import Button from '../components/Button'
import Field from '../components/Field'
import PageHeader from '../components/PageHeader'

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
    <div className="login-screen">
      <div className="login-brand">
        <span className="wordmark">
          <span className="wordmark-name">Nkutwala</span>
          <span className="wordmark-sub">Construction</span>
        </span>
        <p className="login-product">Site Costing</p>
      </div>

      <form className="card login-form" onSubmit={handleSubmit}>
        <PageHeader
          eyebrow="Welcome"
          title="Log in"
          meta="Use the account your administrator gave you."
        />

        <Field
          id="email"
          label="Email"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <Field
          id="password"
          label="Password"
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

        <Button type="submit" disabled={busy}>
          {busy ? 'Logging in…' : 'Log in'}
        </Button>
      </form>
    </div>
  )
}

export default LoginPage
