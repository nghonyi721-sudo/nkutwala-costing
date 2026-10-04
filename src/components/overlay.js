import { useCallback, useEffect, useRef, useState } from 'react'

// Shared behaviour for sheets and action sheets: locks page scrolling while
// open, closes on Escape, and plays the slide-down before telling the parent
// it closed (skipped when the phone has Reduce Motion on).
const CLOSE_MS = 220

export function useOverlay(onClose) {
  const [closing, setClosing] = useState(false)
  const closingRef = useRef(false)

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
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (event) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKey)
    }
  }, [close])

  return { closing, close }
}
