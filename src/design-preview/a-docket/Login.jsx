import { useState } from 'react'
import s from './docket.module.css'

// TEMPORARY - Direction A · Docket: the login screen. Preview only - the form
// doesn't send anything anywhere.
function Login() {
  const [note, setNote] = useState('')

  return (
    <div className={`${s.root} ${s.loginRoot}`}>
      <header className={s.topBar}>
        <img className={s.logo} src="/logo.jpeg" alt="Nkutwala Construction" width="112" height="40" />
        <span className={s.formCode}>Site costing</span>
      </header>

      <form
        className={s.loginBody}
        onSubmit={(e) => {
          e.preventDefault()
          setNote('Preview only. Nothing is sent.')
        }}
      >
        <p className={s.loginEyebrow}>Site costing</p>
        <h1 className={s.loginTitle}>Log in</h1>
        <p className={s.loginLead}>Daily activity reports and job costing for every Nkutwala site.</p>

        <label className={s.field}>
          <span className={s.fieldLabel}>Email</span>
          <input
            className={s.input}
            type="email"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            placeholder="name@example.co.za"
          />
        </label>

        <label className={s.field}>
          <span className={s.fieldLabel}>Password</span>
          <input className={s.input} type="password" autoComplete="current-password" />
        </label>

        {note && <p className={s.message}>{note}</p>}

        <button type="submit" className={s.loginButton}>
          Log in
        </button>

        <p className={s.loginFoot}>
          Accounts are set up by the office. Trouble logging in? Ask your administrator.
        </p>
      </form>
    </div>
  )
}

export default Login
