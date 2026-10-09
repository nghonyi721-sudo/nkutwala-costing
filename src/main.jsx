import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import './index.css'
import App from './App.jsx'

// TEMPORARY: the scroll lock badge, in development only (npm run dev). In
// the built app import.meta.env.DEV is false, so it isn't even included.
const ScrollLockBadge = import.meta.env.DEV ? lazy(() => import('./components/ScrollLockBadge')) : null

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
    {ScrollLockBadge && (
      <Suspense fallback={null}>
        <ScrollLockBadge />
      </Suspense>
    )}
  </StrictMode>,
)
