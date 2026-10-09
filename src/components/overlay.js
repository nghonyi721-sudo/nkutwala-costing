import { useCallback, useEffect, useRef, useState } from 'react'
import { useScrollLock } from './scrollLock'

// Shared behaviour for sheets and action sheets: stops the page scrolling
// while open (the shared counter in scrollLock.js - released on close AND on
// unmount, in any order), closes on Escape, and plays the slide-down before
// telling the parent it closed (skipped when the phone has Reduce Motion on).
const CLOSE_MS = 220

export function useOverlay(onClose) {
  const [closing, setClosing] = useState(false)
  const closingRef = useRef(false)

  // One lock for as long as the popup is on screen.
  useScrollLock()

  const close = useCallback(() => {
    if (closingRef.current) return
    closingRef.current = true
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      onClose()
      return
    }
    setClosing(true)
    window.setTimeout(onClose, CLOSE_MS)
  }, [onClose])

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  return { closing, close }
}
