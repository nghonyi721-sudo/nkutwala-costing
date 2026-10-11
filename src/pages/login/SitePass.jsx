import Logo from '../../components/Logo'
import LoginForm from './LoginForm'
import { APP_VERSION, greeting, todayText } from './today'
import s from './SitePass.module.css'

// A barcode drawn from the version text - decoration only (it scans as
// nothing).
function Barcode({ text }) {
  let x = 0
  const bars = []
  for (const [index, char] of [...`*${text}*`].entries()) {
    const code = char.charCodeAt(0)
    for (let bit = 0; bit < 4; bit += 1) {
      const width = 1 + ((code >> bit) & 1) + ((code >> (bit + 4)) & 1)
      if ((index + bit) % 2 === 0) bars.push(<rect key={`${index}-${bit}`} x={x} y="0" width={width} height="28" />)
      x += width + 1
    }
  }
  return (
    <svg className={s.barcode} viewBox={`0 0 ${x} 28`} preserveAspectRatio="none" aria-hidden="true">
      {bars}
    </svg>
  )
}

const TEETH = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330]

// The logo's gear, very faint, tucked into the band's corner. The drawing is
// cropped by its own box (no overflow tricks on the page).
function GearMark() {
  return (
    <svg className={s.gear} viewBox="-100 -46 146 146" aria-hidden="true">
      <circle r="70" fill="none" stroke="currentColor" strokeWidth="20" />
      {TEETH.map((angle) => (
        <rect key={angle} x="-9" y="-98" width="18" height="22" rx="3" fill="currentColor" transform={`rotate(${angle})`} />
      ))}
      <circle r="26" fill="currentColor" />
    </svg>
  )
}

// The sign-in page, "Site pass": the morning at the gate. Today's date and a
// greeting on a soft blue band, and the form on a SITE ACCESS card - lanyard
// slot, the logo, and a barcode carrying the version. Solid colours only: the
// logo blue, toned down (SitePass.module.css).
//   login: from useSignIn()
function SitePass({ login }) {
  return (
    <div className={s.screen}>
      <main className={s.page}>
        <header className={s.band}>
          <GearMark />
          <p className={s.date}>{todayText()}</p>
          <h1 className={s.hello}>{greeting()}.</h1>
          <p className={s.sub}>Sign in to start the day on site.</p>
        </header>

        <section className={s.pass} aria-label="Sign in">
          <div className={s.passTop}>
            <span className={s.slot} aria-hidden="true" />
            <div className={s.passRow}>
              <span className={s.passLabel}>
                Site access
                <span className={s.passName}>Site Reports</span>
              </span>
              <span className={s.logoTile}>
                <Logo width={92} />
              </span>
            </div>
          </div>
          <div className={s.passBody}>
            <LoginForm login={login} />
          </div>
          <div className={s.passFoot}>
            <Barcode text={APP_VERSION ?? ''} />
            <span className={s.passNo}>Version {APP_VERSION}</span>
          </div>
        </section>

        <p className={s.help}>Forgot password? Contact the office.</p>
      </main>
    </div>
  )
}

export default SitePass
