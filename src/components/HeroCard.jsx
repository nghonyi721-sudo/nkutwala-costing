import { GearSixIcon } from './icons'
import s from './HeroCard.module.css'

// A brand summary card: logo blue (or black, for money), white text, big
// numbers, a red diagonal across the corner (the N's stroke) and a faint cog
// (from the logo) in the background.
//   eyebrow: small line on top (e.g. the date)
//   badge:   short word in a white pill (e.g. "Draft")
//   figures: [{ label, value, unit, main }] - the main one is shown large
function HeroCard({ tone = 'blue', eyebrow, badge, title, figures = [] }) {
  const main = figures.find((figure) => figure.main)
  const rest = figures.filter((figure) => !figure.main)

  return (
    <section className={`${s.card} ${s[tone]}`}>
      <span className={s.stroke} aria-hidden="true" />
      <GearSixIcon className={s.cog} size={150} aria-hidden="true" />

      <div className={s.content}>
        {(eyebrow || badge) && (
          <div className={s.top}>
            {eyebrow && <p className={s.eyebrow}>{eyebrow}</p>}
            {badge && <span className={s.badge}>{badge}</span>}
          </div>
        )}
        {title && <p className={s.title}>{title}</p>}

        {main && (
          <p className={s.main}>
            <span className={s.mainLabel}>{main.label}</span>
            <span className={`${s.mainValue} num`}>
              {main.value}
              {main.unit && <span className={s.mainUnit}>{main.unit}</span>}
            </span>
          </p>
        )}

        {rest.length > 0 && (
          <dl className={s.figures}>
            {rest.map((figure) => (
              <div key={figure.label} className={s.figure}>
                <dt>{figure.label}</dt>
                <dd className="num">
                  {figure.value}
                  {figure.unit && <span className={s.unit}>{figure.unit}</span>}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </section>
  )
}

export default HeroCard
