import { createContext, useContext, useEffect } from 'react'

// Shared by AppShell (which provides it) and Page/NavBar (which use it):
//   push / pop        - a "pushed" screen (form or detail) hides the tab bar
//   isReturning()     - true while a pushed screen is still on screen, so the
//                       list it goes back to can slide in from the left
//   tabs, desktopTabs, screen, onNavigate, profile, openAccount - for the
//                       nav bar (desktopTabs: the wider top bar's list)
export const ShellContext = createContext(null)

export function useShell() {
  return useContext(ShellContext)
}

export function usePushedScreen(active) {
  const shell = useContext(ShellContext)
  const push = shell?.push
  const pop = shell?.pop
  useEffect(() => {
    if (!active || !push) return undefined
    push()
    return pop
  }, [active, push, pop])
}
