import { useEffect, useState } from 'react'
import DocketLogin from './a-docket/Login'
import DocketReport from './a-docket/DailyReport'
import FieldKitLogin from './b-fieldkit/Login'
import FieldKitReport from './b-fieldkit/DailyReport'
import NativeLogin from './c-native/Login'
import NativeReport from './c-native/DailyReport'
import styles from './preview.module.css'

// TEMPORARY - design pass 2. Three design directions for the daily report and
// login screens, shown with made-up sample data only (no database at all).
// Address: /design-preview?d=a|b|c&s=report|login. Removed once one is chosen.

const DIRECTIONS = {
  a: {
    name: 'A · Docket',
    about:
      'The daily report as a well-made site document. White paper, IBM Plex type with every number in mono, fine hairlines instead of boxes and almost-square corners. No icons: type size and spacing carry the hierarchy, and red only marks section numbers and warnings.',
    Report: DocketReport,
    Login: DocketLogin,
  },
  b: {
    name: 'B · Field Kit',
    about:
      'A rugged tool for gloved thumbs. Barlow type (drawn from road signage), chunky rounded controls, bold line icons and a progress strip showing which sections are done. Each section folds into a one-line summary, and Save and Submit are always at the bottom.',
    Report: FieldKitReport,
    Login: FieldKitLogin,
  },
  c: {
    name: 'C · Native',
    about:
      'Feels like it came with your phone. A grey background with white rounded groups like the Settings app, the phone’s own font, small grey line icons, and pop-up sheets for picking people and machines. The quietest of the three: whitespace, not lines, separates things.',
    Report: NativeReport,
    Login: NativeLogin,
  },
}

const SCREENS = { report: 'Daily report', login: 'Login' }

function readAddress() {
  const params = new URLSearchParams(window.location.search)
  const direction = params.get('d')
  const screen = params.get('s')
  return {
    direction: direction && Object.hasOwn(DIRECTIONS, direction) ? direction : 'a',
    screen: screen && Object.hasOwn(SCREENS, screen) ? screen : 'report',
  }
}

function DesignPreview() {
  const [view, setView] = useState(readAddress)
  const [showNotes, setShowNotes] = useState(true)

  // Keep the choice in the address so a link opens the same direction.
  useEffect(() => {
    const params = new URLSearchParams({ d: view.direction, s: view.screen })
    window.history.replaceState(null, '', `${window.location.pathname}?${params}`)
  }, [view])

  function choose(changes) {
    setView((current) => ({ ...current, ...changes }))
    window.scrollTo(0, 0)
  }

  const direction = DIRECTIONS[view.direction]
  const Screen = view.screen === 'login' ? direction.Login : direction.Report

  return (
    <div className={styles.page}>
      <div className={styles.bar}>
        <div className={styles.barRow}>
          <span className={styles.barTitle}>Design preview</span>
          <div className={styles.segment} role="group" aria-label="Design direction">
            {Object.keys(DIRECTIONS).map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={key === view.direction}
                onClick={() => choose({ direction: key })}
              >
                {key.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <div className={`${styles.segment} ${styles.segmentWide}`} role="group" aria-label="Screen">
          {Object.entries(SCREENS).map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={key === view.screen}
              onClick={() => choose({ screen: key })}
            >
              {label}
            </button>
          ))}
        </div>

        {showNotes ? (
          <div className={styles.notes}>
            <p className={styles.notesName}>{direction.name}</p>
            <p>{direction.about}</p>
            <button type="button" className={styles.notesToggle} onClick={() => setShowNotes(false)}>
              Hide notes
            </button>
          </div>
        ) : (
          <button type="button" className={styles.notesToggle} onClick={() => setShowNotes(true)}>
            About {direction.name}
          </button>
        )}
      </div>

      <div className={styles.frame}>
        <Screen key={`${view.direction}-${view.screen}`} />
      </div>
    </div>
  )
}

export default DesignPreview
