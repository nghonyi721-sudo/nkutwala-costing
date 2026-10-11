import { useRef, useState } from 'react'
import Button from '../../components/Button'
import { EyeIcon, EyeSlashIcon, WarningCircleIcon } from '../../components/icons'
import { useKeyboardSafe } from './useKeyboardSafe'
import s from './LoginForm.module.css'

// The sign-in form: labels above soft filled fields, then Sign in.
// One <form> with autocomplete="username" / "current-password", so phone
// keychains and password managers fill and save it. Enter / Go signs in
// (Enter on the email field moves to the password while it's empty). The
// keyboard never covers Sign in (useKeyboardSafe).
//   login: from useSignIn()
function LoginForm({ login }) {
  const formRef = useRef(null)
  const buttonRef = useRef(null)
  const passwordRef = useRef(null)
  const [showPassword, setShowPassword] = useState(false)
  useKeyboardSafe(formRef, buttonRef)

  function onSubmit(event) {
    event.preventDefault()
    login.submit()
  }

  function onEmailKey(event) {
    if (event.key === 'Enter' && !login.password) {
      event.preventDefault()
      passwordRef.current?.focus()
    }
  }

  return (
    <form ref={formRef} className={s.form} onSubmit={onSubmit} noValidate>
      <div className={s.fields}>
        <label className={s.field}>
          <span className={s.label}>Email</span>
          <span className={s.control}>
            <input
              className={s.input}
              type="email"
              name="email"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="next"
              placeholder="name@company.co.za"
              value={login.email}
              onChange={(e) => login.setEmail(e.target.value)}
              onKeyDown={onEmailKey}
            />
          </span>
        </label>
        <label className={s.field}>
          <span className={s.label}>Password</span>
          <span className={s.control}>
            <input
              ref={passwordRef}
              className={s.input}
              type={showPassword ? 'text' : 'password'}
              name="password"
              autoComplete="current-password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
              placeholder="Password"
              value={login.password}
              onChange={(e) => login.setPassword(e.target.value)}
            />
            <button
              type="button"
              className={s.reveal}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
              // Keep the keyboard up: don't take the focus from the field.
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => setShowPassword((shown) => !shown)}
            >
              {showPassword ? (
                <EyeSlashIcon size={24} aria-hidden="true" />
              ) : (
                <EyeIcon size={24} aria-hidden="true" />
              )}
            </button>
          </span>
        </label>
      </div>

      {login.error && (
        <p className={s.error} role="alert">
          <WarningCircleIcon size={20} weight="bold" aria-hidden="true" />
          {login.error}
        </p>
      )}

      <div ref={buttonRef}>
        <Button type="submit" busy={login.busy} disabled={login.busy}>
          {login.busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </div>
    </form>
  )
}

export default LoginForm
