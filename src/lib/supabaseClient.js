import { createClient } from '@supabase/supabase-js'

// These values come from the .env file in the project root.
// Vite only exposes variables that start with VITE_ to the browser.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// True once real values have been filled in (not the placeholders).
export const isSupabaseConfigured =
  Boolean(supabaseUrl && supabaseAnonKey) &&
  !supabaseUrl.includes('your-project') &&
  !supabaseAnonKey.includes('your-anon-key')

// One shared connection for the whole app. Null until .env is filled in.
export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null
