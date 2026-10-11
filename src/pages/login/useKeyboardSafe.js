import { useEffect } from 'react'

// Phones: the on-screen keyboard must never cover the Sign in button.
// While a field in the form is focused, this measures the keyboard (the part
// of the screen the visual viewport has lost), sets --keyboard on the FORM
// (it pads itself by that much, so the page can scroll that far) and scrolls
// just enough to bring the button above the keyboard. Works in Safari, Chrome
// and the installed app; no scroll locking, nothing fixed, the body is never
// touched.
//   formRef:   the <form>
//   targetRef: what must stay visible (the Sign in button)
export function useKeyboardSafe(formRef, targetRef) {
  useEffect(() => {
    const viewport = window.visualViewport
    const form = formRef.current
    if (!viewport || !form) return undefined
    let frame = 0
    let timer = 0

    function update() {
      const active = document.activeElement
      const focused = form.contains(active) && active?.tagName === 'INPUT'
      const keyboard = focused ? Math.max(0, Math.round(window.innerHeight - viewport.height)) : 0
      form.style.setProperty('--keyboard', `${keyboard}px`)
      if (!focused || keyboard === 0) return

      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const target = targetRef.current
        if (!target) return
        const bottom = target.getBoundingClientRect().bottom
        const visibleBottom = viewport.offsetTop + viewport.height - 12
        if (bottom > visibleBottom) window.scrollBy({ top: bottom - visibleBottom, behavior: 'smooth' })
      })
    }

    // The keyboard animates in: check when the viewport changes size, and
    // once more shortly after a field is focused or left.
    const later = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(update, 350)
    }
    viewport.addEventListener('resize', update)
    form.addEventListener('focusin', later)
    form.addEventListener('focusout', later)
    return () => {
      viewport.removeEventListener('resize', update)
      form.removeEventListener('focusin', later)
      form.removeEventListener('focusout', later)
      cancelAnimationFrame(frame)
      window.clearTimeout(timer)
    }
  }, [formRef, targetRef])
}
