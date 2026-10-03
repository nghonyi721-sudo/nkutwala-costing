import { isSupabaseConfigured } from './lib/supabaseClient'
import './App.css'

function App() {
  return (
    <main className="app">
      <h1>Nkutwala Job Costing</h1>
      <p>Setup complete. Features coming soon.</p>
      <p className={isSupabaseConfigured ? 'status ok' : 'status warn'}>
        {isSupabaseConfigured
          ? 'Supabase: configured'
          : 'Supabase: not configured yet - add your keys to the .env file'}
      </p>
    </main>
  )
}

export default App
