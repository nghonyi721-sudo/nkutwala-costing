// Small words for the sign-in page: the greeting for the time of day, today's
// date as people say it, and the app's version (set at build time).

export function greeting(now = new Date()) {
  const hour = now.getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

// "Saturday 11 October"
export function todayText(now = new Date()) {
  return now.toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long' })
}

export const APP_VERSION = import.meta.env.VITE_APP_VERSION
