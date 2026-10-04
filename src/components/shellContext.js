import { createContext, useContext, useEffect } from 'react'

// Lets a "pushed" screen (a form or detail view opened from a list) hide the
// bottom tab bar while it's showing, like phone apps do.
export const ShellContext = createContext(null)

export function usePushedScreen(active) {
  const shell = useContext(ShellContext)
  useEffect(() => {
    if (!active || !shell) return undefined
    shell.push()
    return shell.pop
  }, [active, shell])
}
