import { formatDate, formatRand } from '../../lib/labels'
import { CaretRightIcon } from '../../components/icons'
import s from './Dashboard.module.css'

// The dashboard's building blocks, in the style of the iPhone Health summary.
// They only lay out and draw the database's numbers - bar lengths and the
// ring come straight from its percentages, with no maths here.

const TONES = { blue: s.toneBlue, red: s.toneRed, grey: s.toneGrey }

// A card: coloured icon and title (and a chevron when it opens something),
// then its content.
//   meta:  small text on the right of the title (e.g. "Project to date")
//   wide:  spans both columns on a laptop
//   flush: the content runs edge to edge (rows, the calendar)
export function DashboardCard({ icon: Icon, title, tone = 'blue', meta, onOpen, wide = false, flush = false, index = 0, children }) {
  const Head = onOpen ? 'button' : 'div'
  return (
    <section className={wide ? `${s.card} ${s.wide}` : s.card} style={{ '--i': index }}>
      <Head type={onOpen ? 'button' : undefined} className={s.cardHead} onClick={onOpen}>
        <span className={`${s.cardIcon} ${TONES[tone]}`} aria-hidden="true">
          <Icon size={16} weight="fill" />
        </span>
        <span className={s.cardTitle}>{title}</span>
        {meta && <span className={s.cardMeta}>{meta}</span>}
        {onOpen && <CaretRightIcon className={s.cardChevron} size={14} weight="bold" aria-hidden="true" />}
      </Head>
      <div className={flush ? s.cardBodyFlush : s.cardBody}>{children}</div>
    </section>
  )
}

// A key-number tile: label, one big number, a note, and an optional
// picture (trend line or ring). Tappable when onOpen is given.
export function Tile({ icon: Icon, label, value, unit, note, tone = 'blue', onOpen, index = 0, children }) {
  const Tag = onOpen ? 'button' : 'div'
  return (
    <Tag
      type={onOpen ? 'button' : undefined}
      className={onOpen ? `${s.tile} ${s.tileButton}` : s.tile}
      style={{ '--i': index }}
      onClick={onOpen}
    >
      <span className={`${s.tileLabel} ${TONES[tone]}`}>
        <Icon size={15} weight="fill" aria-hidden="true" />
        {label}
        {onOpen && <CaretRightIcon className={s.tileChevron} size={12} weight="bold" aria-hidden="true" />}
      </span>
      <span className={s.tileMain}>
        <span className={s.tileValue}>
          <span className="num">{value}</span>
          {unit && <span className={s.tileUnit}>{unit}</span>}
        </span>
        {children}
      </span>
      {note && <span className={s.tileNote}>{note}</span>}
    </Tag>
  )
}

// A ring showing how much of the budget is used. The database's % sets the
// coloured arc's length directly (the circle counts as 100 long); anything
// over 100% simply fills the ring. Red from 90%.
export function BudgetRing({ percent, warning }) {
  return (
    <svg className={s.ring} viewBox="0 0 36 36" aria-hidden="true">
      <circle className={s.ringTrack} cx="18" cy="18" r="15" pathLength="100" />
      {percent !== null && (
        <circle
          className={warning ? `${s.ringValue} ${s.ringWarning}` : s.ringValue}
          cx="18"
          cy="18"
          r="15"
          pathLength="100"
          strokeDasharray={`${percent} 100`}
          transform="rotate(-90 18 18)"
        />
      )}
    </svg>
  )
}

const MIX_CLASSES = { labour: s.mixLabour, owned_plant: s.mixOwnedPlant, receipts: s.mixReceipts }

// One bar split into labour / owned plant / receipts, with a legend.
//   mix:    from dashboard_mix (amount and percent per source)
//   onPick: tap a part with money in it to see what's behind it (source)
export function MixBar({ mix, onPick }) {
  return (
    <>
      <div className={s.mixBar} aria-hidden="true">
        {mix.map((part) =>
          part.percent === null ? null : (
            <span key={part.source} className={MIX_CLASSES[part.source]} style={{ width: `${part.percent}%` }} />
          ),
        )}
      </div>
      <ul className={s.legend}>
        {mix.map((part) => {
          const content = (
            <>
              <span className={`${s.swatch} ${MIX_CLASSES[part.source]}`} aria-hidden="true" />
              <span className={s.legendLabel}>{part.label}</span>
              <span className={`${s.legendAmount} num`}>{formatRand(part.amount)}</span>
              <span className={`${s.legendPercent} num`}>{part.percent === null ? '–' : `${part.percent}%`}</span>
            </>
          )
          return onPick && Number(part.amount) !== 0 ? (
            <li key={part.source} className={s.tappableItem}>
              <button type="button" className={s.legendButton} onClick={() => onPick(part.source, part.label)}>
                {content}
                <CaretRightIcon className={s.rowChevron} size={12} weight="bold" aria-hidden="true" />
              </button>
            </li>
          ) : (
            <li key={part.source}>{content}</li>
          )
        })}
      </ul>
    </>
  )
}

const HEALTH = {
  over: { label: 'Over budget', className: s.pillOver },
  watch: { label: 'Watch', className: s.pillWatch },
  on_track: { label: 'On track', className: s.pillOk },
  no_budget: { label: 'No budget', className: s.pillNone },
}

export function HealthPill({ health }) {
  const pill = HEALTH[health] ?? HEALTH.no_budget
  return <span className={`${s.pill} ${pill.className}`}>{pill.label}</span>
}

// Every project at a glance, worst first. Tap one to see what's behind its
// spend to date.
//   projects: from dashboard_projects
//   onPick(project): a row was tapped
// Overtime over the pay rule's limits (warn only): one line per person per
// day or week, from the database. Tap a line to see the person's days.
//   warnings: rows of overtime_warnings
export function OvertimeWarnings({ warnings, onPick }) {
  return (
    <ul className={s.healthList}>
      {warnings.map((warning) => (
        <li key={`${warning.employee_id}-${warning.kind}-${warning.day}`}>
          <button type="button" className={s.healthRow} onClick={() => onPick(warning)}>
            <span className={s.healthTop}>
              <span className={s.healthName}>{warning.employee_name}</span>
              <span className={s.healthUnpriced}>{warning.kind === 'week' ? 'Week' : 'Day'}</span>
            </span>
            <span className={`${s.healthFigures} num`}>
              {warning.kind === 'week'
                ? `${Number(warning.hours).toFixed(1)} h overtime in the week of ${formatDate(warning.day)} (limit ${Number(warning.limit_hours)} h)`
                : `${Number(warning.hours).toFixed(1)} h on ${formatDate(warning.day)} (limit ${Number(warning.limit_hours)} h a day)`}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

export function ProjectHealth({ projects, onPick }) {
  return (
    <ul className={s.healthList}>
      {projects.map((project) => (
        <li key={project.project_id}>
          <button type="button" className={s.healthRow} onClick={() => onPick(project)}>
            <span className={s.healthTop}>
              <span className={s.healthName}>{project.project_name}</span>
              <HealthPill health={project.health} />
            </span>
            {project.percent_used !== null && (
              <span
                className={project.health === 'on_track' ? s.healthBar : `${s.healthBar} ${s.healthBarWarning}`}
                aria-hidden="true"
              >
                <span style={{ width: `${project.percent_used}%` }} />
              </span>
            )}
            <span className={`${s.healthFigures} num`}>
              {project.budget === null
                ? `${formatRand(project.spent_to_date)} spent`
                : `${formatRand(project.spent_to_date)} of ${formatRand(project.budget)} · ${project.percent_used}%`}
              {Number(project.unpriced_hours) > 0 && (
                <span className={s.healthUnpriced}> · {Number(project.unpriced_hours).toFixed(1)} h unpriced</span>
              )}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
