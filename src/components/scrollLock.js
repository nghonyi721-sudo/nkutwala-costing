import { useEffect } from 'react'

// THE one place that stops the page scrolling behind a popup (sheets, pickers,
// confirm dialogs, the photo viewer). Nothing else may change the body's
// style.
//
// A COUNTER, not "save and restore": every open popup holds one lock and the
// page scrolls again only when the count is back to 0 - whatever order popups
// close in. (Saving and restoring the old value left the page stuck when two
// popups closed together, e.g. the Account sheet and "Log out?".)

let count = 0
// Bumped by resetScrollLock(): locks taken before a reset are forgotten.
let generation = 0
const listeners = new Set()

function apply() {
  document.body.style.overflow = count > 0 ? 'hidden' : ''
  listeners.forEach((listener) => listener())
}

// Take a lock. Returns its release; releasing twice (or after a reset) does
// nothing.
export function lockScroll() {
  count += 1
  apply()
  const taken = generation
  let released = false
  return () => {
    if (released) return
    released = true
    if (taken !== generation) return
    count = Math.max(0, count - 1)
    apply()
  }
}

// Every screen change: the page scrolls again, whatever happened before.
export function resetScrollLock() {
  generation += 1
  count = 0
  apply()
}

// While the component is on screen (and active), the page doesn't scroll.
export function useScrollLock(active = true) {
  useEffect(() => (active ? lockScroll() : undefined), [active])
}

// For the dev-only badge.
export const scrollLockCount = () => count
export function onScrollLockChange(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
