import { useState } from 'react'

// Signing in: the fields, the busy state and the message. HOW sign-in works
// is the caller's (Supabase's signInWithPassword on the real page; a pretend
// one on the design preview) - this only decides what the person is told.
//
// SECURITY: every refusal from the sign-in service gets ONE message. It never
// says which of email or password was wrong, or whether an account exists.

export const SIGN_IN_MESSAGES = {
  wrong: 'Email or password is incorrect.',
  offline: 'No connection — check your signal.',
  tooMany: 'Too many tries. Wait a minute, then try again.',
  server: "Can't sign in right now. Try again in a minute.",
  empty: 'Enter your email and password.',
}

const NETWORK = /failed to fetch|networkerror|network request failed|load failed|fetch failed/i

// A sign-in error (returned or thrown) -> the message to show.
export function signInMessage(error) {
  const status = Number(error?.status ?? 0)
  const text = String(error?.message ?? '')
  // The request never reached the sign-in service.
  if ((error?.name === 'AuthRetryableFetchError' && status < 500) || NETWORK.test(text)) return SIGN_IN_MESSAGES.offline
  if (status === 429) return SIGN_IN_MESSAGES.tooMany
  if (status >= 500) return SIGN_IN_MESSAGES.server
  return SIGN_IN_MESSAGES.wrong
}

//   signIn({ email, password }) -> Promise<{ error }>
export function useSignIn(signIn) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (busy) return
    if (!email.trim() || !password) {
      setError(SIGN_IN_MESSAGES.empty)
      return
    }
    // The phone knows it has no connection: don't even try.
    if (navigator.onLine === false) {
      setError(SIGN_IN_MESSAGES.offline)
      return
    }
    setError('')
    setBusy(true)
    try {
      const { error: refused } = await signIn({ email: email.trim(), password })
      if (refused) setError(signInMessage(refused))
      // On success App.jsx notices the new session and shows the app.
    } catch (thrown) {
      setError(NETWORK.test(String(thrown?.message ?? '')) ? SIGN_IN_MESSAGES.offline : SIGN_IN_MESSAGES.server)
    } finally {
      setBusy(false)
    }
  }

  return { email, setEmail, password, setPassword, error, setError, busy, submit }
}
