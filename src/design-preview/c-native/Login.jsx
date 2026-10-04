import { useState } from 'react'
import s from './native.module.css'

// TEMPORARY - Direction C · Native: the login screen. Preview only - the form
// doesn't send anything anywhere.
function Login() {
  const [note, setNote] = useState('')

  return (
    <form
      className={`${s.root} ${s.loginRoot}`}
      onSubmit={(e) => {
        e.preventDefault()
        setNote('Preview only. Nothing is sent.')
      }}
    >
      <div className={s.loginStage}>
        <div className={s.loginCard}>
          <img className={s.loginLogo} src="/logo.jpeg" alt="Nkutwala Construction" width="120" height="43" />
          <p className={s.loginProduct}>Site Costing</p>
          <p className={s.loginTagline}>Daily activity reports and job costing</p>
        </div>
      </div>

      <div className={s.loginSheet}>
        <div>
          <h1 className={s.loginTitle}>Log in</h1>
          <p className={s.subtitle}>Use the account the office set up for you.</p>
        </div>

        <div className={s.formGroup}>
          <label className={s.formRow}>
            <span className={s.formLabel}>Email</span>
            <input
              className={s.sheetInput}
              type="email"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              placeholder="name@example.co.za"
            />
          </label>
          <label className={s.formRow}>
            <span className={s.formLabel}>Password</span>
            <input className={s.sheetInput} type="password" autoComplete="current-password" />
          </label>
        </div>

        {note && <p className={s.message}>{note}</p>}

        <button type="submit" className={s.loginButton}>
          Log in
        </button>
        <p className={s.loginNote}>Forgot your password? Ask the office.</p>
      </div>
    </form>
  )
}

export default Login
