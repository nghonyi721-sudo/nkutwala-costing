// The launch screen (#splash in index.html) is plain HTML, so it shows before
// any JavaScript has downloaded. The app calls hideSplash() once the first
// real screen is ready (the login page, or the signed-in home screen with the
// person's role known). It fades out and is then REMOVED from the page -
// never just hidden - so no full-screen layer is ever left over the app.
// Safe to call more than once.
//
//   atLeast: keep it up until this many ms after the page started loading
//            (the login page uses 3 s). A slow start doesn't add to it.

let gone = false
let timer

export function hideSplash({ atLeast = 0 } = {}) {
  if (gone) return
  window.clearTimeout(timer)
  const wait = atLeast - performance.now()
  if (wait > 0) {
    timer = window.setTimeout(leave, wait)
    return
  }
  leave()
}

function leave() {
  if (gone) return
  gone = true

  const splash = document.getElementById('splash')
  if (!splash) return

  // Reduce Motion: no fade, just gone.
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    splash.remove()
    return
  }

  // Fade (0.2 s, taps already go through to the app), then remove. Removed
  // after 0.4 s whatever happens, in case the fade never reports back.
  const remove = () => splash.remove()
  splash.addEventListener('transitionend', remove, { once: true })
  window.setTimeout(remove, 400)
  splash.classList.add('is-leaving')
}
