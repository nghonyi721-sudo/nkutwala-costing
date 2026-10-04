import { lazy } from 'react'

// TEMPORARY (design pass 2): the /design-preview address. The preview code is
// only downloaded when this address is opened.
export const isDesignPreview = window.location.pathname.replace(/\/+$/, '') === '/design-preview'

export const DesignPreview = lazy(() => import('./DesignPreview.jsx'))
