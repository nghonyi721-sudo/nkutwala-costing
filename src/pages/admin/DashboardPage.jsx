import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { PERIODS, fetchActionItems, fetchDashboard, fetchPeriod } from '../../lib/dashboard'
import { fetchToDate } from '../../lib/drilldown'
import { formatDate, formatRand } from '../../lib/labels'
import Button from '../../components/Button'
import {
  CaretRightIcon,
  ChartBarIcon,
  ChartDonutIcon,
  CoinsIcon,
  MapPinIcon,
  RankingIcon,
  ReceiptIcon,
  TrendUpIcon,
  UserIcon,
  WarningIcon,
} from '../../components/icons'
import Notice from '../../components/Notice'
import Page from '../../components/Page'
import { Row } from '../../components/Row'
import Section from '../../components/Section'
import SegmentedControl from '../../components/SegmentedControl'
import { PickSheet } from '../../components/Sheet'
import { BudgetRing, DashboardCard, MixBar, ProjectHealth, Tile } from './DashboardCard'
import { CumulativeChart, Sparkline, WeeklyMixChart } from './LazyCharts'
import DrillDown from './DrillDown'
import ExportButton from './ExportButton'
import EmployeeCalendar from './EmployeeCalendar'
import ProjectBudget from './ProjectBudget'
import ReportView from './ReportView'
import {
  allReceiptsLevel,
  categoryLevel,
  spendingLevel,
  unpricedLevel,
  vendorLevel,
} from './drill/levels'
import s from './Dashboard.module.css'

const ALL = 'all'

// "1 Oct 2026 – 5 Oct 2026", or one date when they're the same.
function periodText(period) {
  if (!period) return ''
  const from = formatDate(period.from_date)
  return period.from_date === period.to_date ? from : `${from} – ${formatDate(period.to_date)}`
}

// Grey shapes where the tiles and cards will be, while loading.
function DashboardPlaceholder() {
  return (
    <div role="status" aria-label="Loading the dashboard">
      <div className={s.tiles}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={`${s.tile} ${s.placeholder}`} />
        ))}
      </div>
      <div className={s.grid}>
        <div className={`${s.card} ${s.wide} ${s.placeholder} ${s.placeholderTall}`} />
        <div className={`${s.card} ${s.placeholder} ${s.placeholderTall}`} />
        <div className={`${s.card} ${s.placeholder} ${s.placeholderTall}`} />
      </div>
    </div>
  )
}

// Owner/admin: how the projects are doing. RULE: no cost arithmetic here -
// every total, % and split comes from the database (src/lib/dashboard.js);
// this screen only formats and draws them. Nothing is stored on the device.
//   onNavigate: switch to another tab (e.g. the Receipts queue)
function DashboardPage({ onNavigate }) {
  const [projects, setProjects] = useState([])
  const [projectFilter, setProjectFilter] = useState(ALL)
  const [preset, setPreset] = useState('this_month')
  const [pickingProject, setPickingProject] = useState(false)

  // { key, period, summary, categories, weeklyMix, mix, vendors, cumulative, projects }
  const [view, setView] = useState(null)
  const [actions, setActions] = useState(null)
  const [error, setError] = useState('')
  const [reloadCount, setReloadCount] = useState(0)
  // A screen opened from here: { screen: 'drill' | 'budget' | 'report', ... }
  const [open, setOpen] = useState(null)
  const [drillError, setDrillError] = useState('')

  const projectId = projectFilter === ALL ? null : projectFilter
  const project = projects.find((p) => p.id === projectId)
  const key = `${projectFilter}|${preset}|${reloadCount}`

  useEffect(() => {
    supabase
      .from('projects')
      .select('id, name, status')
      .order('name')
      .then(({ data }) => setProjects(data ?? []))
  }, [])

  useEffect(() => {
    let cancelled = false
    fetchActionItems()
      .then((items) => !cancelled && setActions(items))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [reloadCount])

  useEffect(() => {
    let cancelled = false
    const filterKey = `${projectFilter}|${preset}|${reloadCount}`
    const id = projectFilter === ALL ? null : projectFilter

    fetchPeriod(preset, id)
      .then(async (period) => {
        const data = await fetchDashboard(id, period.from_date, period.to_date)
        if (cancelled) return
        setError('')
        setView({ key: filterKey, period, ...data })
      })
      .catch(() => {
        if (!cancelled) setError('Could not load the dashboard. Check your signal and try again.')
      })

    return () => {
      cancelled = true
    }
  }, [projectFilter, preset, reloadCount])

  const back = () => {
    setOpen(null)
    setReloadCount((count) => count + 1)
  }
  if (open?.screen === 'drill') return <DrillDown start={open.start} onExit={back} />
  if (open?.screen === 'budget') return <ProjectBudget project={open.project} backLabel="Dashboard" onBack={back} />
  if (open?.screen === 'report') return <ReportView reportId={open.reportId} backLabel="Dashboard" onBack={back} />

  const current = view?.key === key ? view : null

  // Open the drill-down at a level. Every level keeps the project and the
  // period of the figure tapped, so its total equals that figure.
  const drill = (start) => {
    setDrillError('')
    setOpen({ screen: 'drill', start: { projectName: project?.name ?? null, ...start } })
  }
  // For "to date" figures: the to-date period, as the dashboard counts it.
  const drillToDate = (id, build) => {
    setDrillError('')
    fetchToDate(id)
      .then((period) => drill(build(period)))
      .catch(() => setDrillError('Could not open that. Check your signal and try again.'))
  }
  const setBudgets = () => (project ? setOpen({ screen: 'budget', project }) : onNavigate('projects'))
  const projectOptions = [
    { value: ALL, title: 'All projects' },
    ...projects.map((p) => ({ value: p.id, title: p.name, subtitle: p.status === 'active' ? undefined : 'Not active' })),
  ]

  return (
    <Page
      title="Dashboard"
      subtitle={project?.name ?? 'All projects'}
      wide
      action={
        current ? (
          <ExportButton
            projectId={projectId}
            projectName={project?.name ?? null}
            period={{ from: current.period.from_date, to: current.period.to_date }}
            onError={setDrillError}
          />
        ) : undefined
      }
    >
      {/* Filters */}
      <div className={s.filters}>
        <Section>
          <Row
            icon={MapPinIcon}
            title="Project"
            trailing={project?.name ?? 'All projects'}
            chevron
            onClick={() => setPickingProject(true)}
          />
        </Section>
        <Section plain>
          <SegmentedControl label="Period" options={PERIODS} value={preset} onChange={setPreset} compact />
          <p className={`${s.periodText} num`}>{periodText(current?.period)}</p>
        </Section>
      </div>

      {error && <Notice tone="error">{error}</Notice>}
      {drillError && <Notice tone="error">{drillError}</Notice>}
      {!error && !current && <DashboardPlaceholder />}
      {current?.summary && (
        <Overview
          data={current}
          actions={actions}
          preset={preset}
          projectId={projectId}
          projectName={project?.name ?? null}
          onDrill={drill}
          onDrillToDate={drillToDate}
          onSetBudgets={setBudgets}
          onOpen={setOpen}
          onNavigate={onNavigate}
        />
      )}

      {pickingProject && (
        <PickSheet
          title="Project"
          options={projectOptions}
          selected={projectFilter}
          onPick={setProjectFilter}
          onClose={() => setPickingProject(false)}
        />
      )}
    </Page>
  )
}

// The tiles and cards, drawn from the database's numbers. Figures with money
// (or unpriced hours) behind them can be tapped to drill down.
function Overview({
  data,
  actions,
  preset,
  projectId,
  projectName,
  onDrill,
  onDrillToDate,
  onSetBudgets,
  onOpen,
  onNavigate,
}) {
  const { summary, categories, weeklyMix, mix, vendors, cumulative, projects } = data
  const periodName = PERIODS[preset]
  // The period on screen, for levels opened from figures in it.
  const period = { from: data.period.from_date, to: data.period.to_date, name: periodName }
  const noBudget = summary.budget === null
  const budgetWarning = summary.percent_used !== null && Number(summary.percent_used) > 90
  const overBudget = !noBudget && Number(summary.remaining) < 0
  const unpriced = Number(summary.unpriced_hours) > 0
  const latest = cumulative.at(-1)
  const spentInPeriod = mix.some((part) => Number(part.amount) !== 0)
  const shownCategories = categories.filter((row) => row.budget !== null || Number(row.spent_to_date) !== 0)

  let budgetNote = `${formatRand(summary.remaining)} left · to date`
  if (noBudget) budgetNote = 'No budget set — set budgets'
  else if (overBudget) budgetNote = 'Over budget · to date'

  return (
    <>
      {/* Key numbers */}
      <div className={s.tiles}>
        <Tile
          index={0}
          icon={CoinsIcon}
          label="Spent"
          value={formatRand(summary.spent)}
          note={
            Number(summary.ot_hours) > 0
              ? `${periodName} · incl. ${formatRand(summary.ot_pay)} overtime`
              : `${periodName} · receipts incl. VAT`
          }
          onOpen={() => onDrill(spendingLevel(projectId, projectName, period))}
        >
          {weeklyMix.length > 1 && <Sparkline weeks={weeklyMix} />}
        </Tile>
        <Tile
          index={1}
          icon={ChartDonutIcon}
          tone={budgetWarning ? 'red' : 'blue'}
          label="Budget used"
          value={summary.percent_used === null ? '–' : `${summary.percent_used}%`}
          note={budgetNote}
          onOpen={noBudget ? onSetBudgets : undefined}
        >
          <BudgetRing percent={summary.percent_used} warning={budgetWarning} />
        </Tile>
        <Tile
          index={2}
          icon={WarningIcon}
          tone={unpriced ? 'red' : 'grey'}
          label="Unpriced"
          value={Number(summary.unpriced_hours).toFixed(1)}
          unit="h"
          note={unpriced ? 'No rate yet — add missing rates' : `Every hour priced · ${periodName.toLowerCase()}`}
          onOpen={unpriced ? () => onDrill(unpricedLevel(projectId, period)) : undefined}
        />
        <Tile
          index={3}
          icon={ReceiptIcon}
          label="To approve"
          value={actions ? actions.pending_receipts : '–'}
          note="Receipts waiting · all projects"
          onOpen={() => onNavigate('receipts')}
        />
      </div>

      <div className={s.grid}>
        {/* Spend vs budget, the whole job */}
        <DashboardCard index={4} wide icon={TrendUpIcon} title="Spend vs budget" meta="Project to date">
          {latest ? (
            <>
              <p className={s.cardFigure}>
                <span className="num">{formatRand(latest.cumulative_spent)}</span>
                <span className={s.cardFigureNote}>
                  {latest.budget === null ? 'spent to date · no budget set' : `spent of ${formatRand(latest.budget)} budget`}
                </span>
              </p>
              <CumulativeChart rows={cumulative} />
            </>
          ) : (
            <p className={s.cardEmpty}>No costs yet. They appear as reports are submitted and receipts approved.</p>
          )}
        </DashboardCard>

        {/* Every project at a glance (All projects only) */}
        {projectId === null && projects.length > 0 && (
          <DashboardCard index={5} wide flush icon={MapPinIcon} title="Projects" meta="Tap one to see its spend">
            <ProjectHealth
              projects={projects}
              onPick={(row) =>
                onDrillToDate(row.project_id, (toDate) => spendingLevel(row.project_id, row.project_name, toDate))
              }
            />
          </DashboardCard>
        )}

        {/* Where the money goes */}
        <DashboardCard index={6} icon={ChartBarIcon} title="Where the money goes" meta={periodName}>
          {spentInPeriod ? (
            <>
              <MixBar
                mix={mix}
                onPick={(source, label) =>
                  onDrill(
                    source === 'receipts'
                      ? allReceiptsLevel(projectId, period)
                      : categoryLevel(source, label, projectId, period),
                  )
                }
              />
              {weeklyMix.length > 1 && <WeeklyMixChart weeks={weeklyMix} />}
            </>
          ) : (
            <p className={s.cardEmpty}>Nothing spent in this period. Pick a longer period.</p>
          )}
        </DashboardCard>

        {/* Budget vs actual by category */}
        <DashboardCard index={7} icon={CoinsIcon} title="Budget vs actual" meta="Project to date">
          {shownCategories.length === 0 ? (
            <div className={s.cardEmpty}>
              <p>No budget set.</p>
              <Button variant="plain" inline onClick={onSetBudgets}>
                Set budgets
              </Button>
            </div>
          ) : (
            <>
              <ul className={s.categoryList}>
                {shownCategories.map((row) => {
                  const tappable = Number(row.spent_to_date) !== 0
                  const content = (
                    <>
                      <span className={s.categoryTop}>
                        <span className={s.categoryName}>{row.label}</span>
                        <span className={s.categoryEnd}>
                          <span className={row.warning ? s.over : s.percent}>
                            {row.percent_used === null ? '–' : `${row.percent_used}%`}
                          </span>
                          {tappable && (
                            <CaretRightIcon className={s.rowChevron} size={12} weight="bold" aria-hidden="true" />
                          )}
                        </span>
                      </span>
                      {row.percent_used !== null && (
                        <span className={row.warning ? `${s.bar} ${s.barWarning}` : s.bar} aria-hidden="true">
                          <span style={{ width: `${row.percent_used}%` }} />
                        </span>
                      )}
                      <span className={`${s.categoryFigures} num`}>
                        {formatRand(row.spent_to_date)} / {row.budget === null ? 'no budget' : formatRand(row.budget)}
                      </span>
                    </>
                  )
                  // Spent to date: tap to see what's behind it (to date).
                  return tappable ? (
                    <li key={row.category} className={s.categoryRow}>
                      <button
                        type="button"
                        className={s.categoryButton}
                        onClick={() =>
                          onDrillToDate(projectId, (toDate) => categoryLevel(row.category, row.label, projectId, toDate))
                        }
                      >
                        {content}
                      </button>
                    </li>
                  ) : (
                    <li key={row.category} className={s.categoryRow}>
                      {content}
                    </li>
                  )
                })}
              </ul>
              <p className={s.cardNote}>
                Red: more than 90% of the budget used. Receipts are VAT inclusive. Tap a category to see what's behind it.
              </p>
            </>
          )}
        </DashboardCard>

        {/* Top vendors */}
        <DashboardCard index={8} icon={RankingIcon} title="Top vendors" meta={periodName}>
          {vendors.length === 0 ? (
            <p className={s.cardEmpty}>No approved receipts in this period.</p>
          ) : (
            <>
              <ol className={s.vendorList}>
                {vendors.map((vendor) => (
                  <li key={vendor.vendor}>
                    <button
                      type="button"
                      className={s.vendorButton}
                      onClick={() => onDrill(vendorLevel(vendor.vendor, projectId, period))}
                    >
                      <span className={s.vendorName}>
                        {vendor.vendor}
                        <span className={s.vendorNote}>
                          {vendor.receipts} receipt{Number(vendor.receipts) === 1 ? '' : 's'}
                        </span>
                      </span>
                      <span className={`${s.vendorAmount} num`}>{formatRand(vendor.amount)}</span>
                      <CaretRightIcon className={s.rowChevron} size={12} weight="bold" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ol>
              <p className={s.cardNote}>Approved receipts, VAT inclusive. Tap a vendor to see their receipts.</p>
            </>
          )}
        </DashboardCard>

        {/* Employee hours */}
        <DashboardCard index={9} wide flush icon={UserIcon} title="Employee hours" meta="Submitted reports">
          <EmployeeCalendar
            projectId={projectId}
            onOpenReport={(reportId) => onOpen({ screen: 'report', reportId })}
          />
        </DashboardCard>
      </div>
    </>
  )
}

export default DashboardPage
