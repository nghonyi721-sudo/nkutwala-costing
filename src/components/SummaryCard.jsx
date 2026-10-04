import s from './SummaryCard.module.css'

// An Apple Health-style summary card: a coloured icon and label, one big
// number in rounded numerals, and a row of smaller figures underneath.
//   meta:    something on the right of the label (a date, a status)
//   figures: [{ label, value, unit }]
function SummaryCard({ icon: Icon, label, meta, value, unit, figures = [] }) {
  return (
    <section className={s.card}>
      <div className={s.head}>
        <span className={s.label}>
          {Icon && <Icon size={18} weight="fill" aria-hidden="true" />}
          {label}
        </span>
        {meta && <span className={s.meta}>{meta}</span>}
      </div>

      <p className={s.value}>
        <span className="num">{value}</span>
        {unit && <span className={s.unit}>{unit}</span>}
      </p>

      {figures.length > 0 && (
        <dl className={s.figures}>
          {figures.map((figure) => (
            <div key={figure.label} className={s.figure}>
              <dt>{figure.label}</dt>
              <dd>
                <span className="num">{figure.value}</span>
                {figure.unit && <span className={s.figureUnit}>{figure.unit}</span>}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  )
}

export default SummaryCard
