import { supabase } from '../lib/supabaseClient'
import SitePass from './login/SitePass'
import { useSignIn } from './login/useSignIn'

// Email + password sign-in. There is no sign-up: accounts are created by the
// administrator in the Supabase dashboard. On success App.jsx notices the new
// session and shows the app.
const signIn = ({ email, password }) => supabase.auth.signInWithPassword({ email, password })

function LoginPage() {
  const login = useSignIn(signIn)
  return <SitePass login={login} />
}

export default LoginPage
