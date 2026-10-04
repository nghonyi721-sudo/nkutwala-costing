import { useState } from 'react'
import './fonts'
import { EnvelopeIcon, EyeIcon, EyeSlashIcon, LockIcon, SignInIcon } from '../icons'
import s from './fieldkit.module.css'

// TEMPORARY - Direction B · Field Kit: the login screen. Preview only - the
// form doesn't send anything anywhere.
function Login() {
  const [showPassword, setShowPassword] = useState(false)
  const [note, setNote] = useState('')

  return (
    <form
      className={`${s.root} ${s.loginRoot}`}
      onSubmit={(e) => {
        e.preventDefault()
        setNote('Preview only. Nothing is sent.')
      }}
    >
      <div className={s.loginTop}>
        <img className={s.loginLogo} src="/logo.jpeg" alt="Nkutwala Construction" width="120" height="43" />
        <p className={s.loginKicker}>Site costing</p>
        <h1 className={s.loginTitle}>Log in</h1>
        <p className={s.loginLead}>Daily reports for every Nkutwala site.</p>
      </div>

      <div className={s.loginFields}>
        <label className={`${s.field} ${s.iconField}`}>
          <span className={s.label}>Email</span>
          <EnvelopeIcon className={s.fieldIcon} size={24} weight="bold" aria-hidden="true" />
          <input
            className={s.input}
            type="email"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            placeholder="name@example.co.za"
          />
        </label>

        <div className={`${s.field} ${s.iconField}`}>
          <label className={s.label} htmlFor="fk-password">
            Password
          </label>
          <LockIcon className={s.fieldIcon} size={24} weight="bold" aria-hidden="true" />
          <input
            id="fk-password"
            className={`${s.input} ${s.passwordInput}`}
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
          />
          <button
            type="button"
            className={s.eyeBtn}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            aria-pressed={showPassword}
            onClick={() => setShowPassword((shown) => !shown)}
          >
            {showPassword ? <EyeSlashIcon size={24} weight="bold" /> : <EyeIcon size={24} weight="bold" />}
          </button>
        </div>
      </div>

      <div className={s.loginBottom}>
        {note && <p className={s.message}>{note}</p>}
        <button type="submit" className={s.loginButton}>
          <SignInIcon size={26} weight="bold" aria-hidden="true" />
          Log in
        </button>
        <p className={s.loginNote}>Accounts are set up by the office.</p>
      </div>
    </form>
  )
}

export default Login
