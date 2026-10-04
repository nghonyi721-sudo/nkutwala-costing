import { StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
// IBM Plex, bundled with the app (Latin only, just the weights we use).
import '@fontsource/ibm-plex-sans/latin-400.css'
import '@fontsource/ibm-plex-sans/latin-500.css'
import '@fontsource/ibm-plex-sans/latin-600.css'
import '@fontsource/ibm-plex-sans/latin-700.css'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-500.css'
import './styles/tokens.css'
import './index.css'
import App from './App.jsx'
// TEMPORARY (design pass 2): /design-preview shows three design directions
// using made-up sample data only - no login, no database. Removed once a
// direction is chosen.
import { DesignPreview, isDesignPreview } from './design-preview/route'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isDesignPreview ? (
      <Suspense fallback={null}>
        <DesignPreview />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
)
