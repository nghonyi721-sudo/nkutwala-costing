import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { exportPayrollHours, exportProjectCost, fetchExportPeriod } from '../../lib/exports/run'
import { EXPORT_LABELS, formatDate, formatDateTime, todayLocal } from '../../lib/labels'
import Button from '../../components/Button'
import DateTimeField from '../../components/DateTimeField'
import { CalendarBlankIcon, DownloadSimpleIcon, MapPinIcon } from '../../components/icons'
import Notice from '../../components/Notice'
import Page from '../../components/Page'
import { Row } from '../../components/Row'
import Section from '../../components/Section'
import SegmentedControl from '../../components/SegmentedControl'
import { PickSheet } from '../../components/Sheet'
import Skeleton from '../../components/Skeleton'

const ALL = 'all'
const COST_PERIODS = {
  this_week: 'Week',
  this_month: 'Month',
  last_month: 'Last month',
  project_to_date: 'To date',
  custom: 'Dates',
}
const PAYROLL_PERIODS = { this_month: 'This month', last_month: 'Last month', custom: 'Dates' }
const ALLOCATION_NAME = 'Project labour cost allocation'

// The dates of a chosen period: a preset (worked out by the database, like
// the dashboard's) or the dates picked. Returns { from, to } or a problem.
async function resolvePeriod(preset, projects, custom) {
  if (preset !== 'custom') {
    const period = await fetchExportPeriod(preset, projects)
    return { from: period.from_date, to: period.to_date }
  }
  if (!custom.from || !custom.to) return { problem: 'Choose both dates.' }
  if (custom.from > custom.to) return { problem: 'The first date must be on or before the last date.' }
  return { from: custom.from, to: custom.to }
}

// Two date rows, for "Dates".
function CustomDates({ value, onChange }) {
  return (
    <>
      <Row
        icon={CalendarBlankIcon}
        title="From"
        trailing={
          <DateTimeField type="date" label="From" value={value.from} onChange={(e) => onChange({ ...value, from: e.target.value })} />
        }
      />
      <Row
        icon={CalendarBlankIcon}
        title="To"
        trailing={
          <DateTimeField type="date" label="To" value={value.to} onChange={(e) => onChange({ ...value, to: e.target.value })} />
        }
      />
    </>
  )
}

// Owner/admin: download Excel exports, and see the log of every export.
// Every figure in the files comes from the database; the database refuses
// anyone else. Each export is logged (who, which report, projects, dates,
// when). Each export has its own project filter: All projects (the
// default), or one or more projects.
function ExportsPage() {
  const [projects, setProjects] = useState([])
  // Whose project filter is open: 'cost' | 'payroll' | null
  const [picking, setPicking] = useState(null)

  // The chosen project ids per export; [] = all projects.
  const [chosen, setChosen] = useState({ cost: [], payroll: [] })
  const [costPreset, setCostPreset] = useState('this_month')
  const [costDates, setCostDates] = useState({ from: '', to: todayLocal() })
  const [payPreset, setPayPreset] = useState('last_month')
  const [payDates, setPayDates] = useState({ from: '', to: todayLocal() })

  // 'cost' | 'payroll' while exporting
  const [busy, setBusy] = useState(null)
  const [message, setMessage] = useState({ tone: 'info', text: '' })

  // undefined = loading, array = loaded
  const [log, setLog] = useState(undefined)
  const [logError, setLogError] = useState('')
  const [logCount, setLogCount] = useState(0)

  useEffect(() => {
    supabase
      .from('projects')
      .select('id, name, status')
      .order('name')
      .then(({ data }) => setProjects(data ?? []))
  }, [])

  useEffect(() => {
    let cancelled = false
    supabase
      .from('export_log')
      .select('id, report_type, filters, created_at, user:profiles(full_name)')
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          setLogError('Could not load the export log. Check your signal and try again.')
        } else {
          setLogError('')
          setLog(data)
        }
      })
    return () => {
      cancelled = true
    }
  }, [logCount])

  // The chosen projects in name order, [{ id, name }] - or null for all.
  function chosenProjects(which) {
    const list = projects.filter((p) => chosen[which].includes(p.id)).map(({ id, name }) => ({ id, name }))
    return list.length ? list : null
  }

  // "All projects", the project's name, or e.g. "3 projects".
  function filterText(which) {
    const list = chosenProjects(which)
    if (!list) return 'All projects'
    return list.length === 1 ? list[0].name : `${list.length} projects`
  }

  // Tap "All projects" to clear the choice; tap a project to tick / untick it.
  function toggle(which, value) {
    setChosen((current) => {
      const ids = current[which]
      let next = []
      if (value !== ALL) next = ids.includes(value) ? ids.filter((id) => id !== value) : [...ids, value]
      return { ...current, [which]: next }
    })
  }

  // Payroll with projects chosen = a project labour cost allocation.
  const payAllocation = chosenProjects('payroll') !== null

  async function run(which) {
    setMessage({ tone: 'info', text: '' })
    const picked = chosenProjects(which)
    setBusy(which)
    try {
      const period =
        which === 'cost'
          ? await resolvePeriod(costPreset, picked, costDates)
          : await resolvePeriod(payPreset, picked, payDates)
      if (period.problem) {
        setMessage({ tone: 'error', text: period.problem })
      } else {
        if (which === 'cost') {
          await exportProjectCost({ projects: picked, ...period })
        } else {
          await exportPayrollHours({ projects: picked, ...period })
        }
        const label = which === 'cost' ? EXPORT_LABELS.project_cost : picked ? ALLOCATION_NAME : EXPORT_LABELS.payroll_hours
        setMessage({
          tone: 'info',
          text: `Saved: ${label}, ${filterText(which)}, ${formatDate(period.from)} – ${formatDate(period.to)}.`,
        })
        setLogCount((count) => count + 1)
      }
    } catch {
      setMessage({ tone: 'error', text: 'Could not export. Check your signal and try again.' })
    }
    setBusy(null)
  }

  // The "Projects" row of an export: opens its project filter.
  const projectsRow = (which) => (
    <Row icon={MapPinIcon} title="Projects" trailing={filterText(which)} chevron onClick={() => setPicking(which)} />
  )

  return (
    <Page title="Exports" subtitle="Excel files - confidential, they contain personal information">
      {message.text && <Notice tone={message.tone}>{message.text}</Notice>}

      {/* Project cost report: projects, period, (dates), download */}
      <Section title="Project cost report">{projectsRow('cost')}</Section>
      <Section plain>
        <SegmentedControl label="Period" options={COST_PERIODS} value={costPreset} onChange={setCostPreset} compact />
      </Section>
      {costPreset === 'custom' && (
        <Section>
          <CustomDates value={costDates} onChange={setCostDates} />
        </Section>
      )}
      <Section
        plain
        footer="Summary by category, labour per person with rates, approved receipts and spend per week - a subtotal per project when you choose more than one. Matches the dashboard."
      >
        <Button icon={DownloadSimpleIcon} busy={busy === 'cost'} disabled={Boolean(busy)} onClick={() => run('cost')}>
          {busy === 'cost' ? 'Exporting…' : 'Download Excel'}
        </Button>
      </Section>

      {/* Payroll hours sheet: projects, period, (dates), download */}
      <Section title="Payroll hours sheet">{projectsRow('payroll')}</Section>
      {payAllocation && (
        <Notice tone="error">
          {ALLOCATION_NAME} - NOT the amount to pay employees. Pay only from All projects.
        </Notice>
      )}
      <Section plain>
        <SegmentedControl label="Payroll period" options={PAYROLL_PERIODS} value={payPreset} onChange={setPayPreset} />
      </Section>
      {payPreset === 'custom' && (
        <Section>
          <CustomDates value={payDates} onChange={setPayDates} />
        </Section>
      )}
      <Section
        plain
        footer={
          payAllocation
            ? "Only the chosen projects' share of each person's pay, overtime as allocated. People not yet approved are listed separately."
            : 'All projects: gross with overtime, before deductions - provisional, NOT a payslip. People not yet approved are listed separately.'
        }
      >
        <Button icon={DownloadSimpleIcon} busy={busy === 'payroll'} disabled={Boolean(busy)} onClick={() => run('payroll')}>
          {busy === 'payroll' ? 'Exporting…' : 'Download Excel'}
        </Button>
      </Section>

      <Section title="Export log" footer="Every export, newest first: who, which report and which filters.">
        {logError && <Row title={logError} />}
        {!logError && log === undefined && <Skeleton rows={2} />}
        {log?.length === 0 && <Row title="No exports yet" />}
        {log?.map((row) => (
          <Row
            key={row.id}
            title={row.filters?.allocation ? ALLOCATION_NAME : (EXPORT_LABELS[row.report_type] ?? row.report_type)}
            subtitle={
              [
                row.filters?.projects ?? row.filters?.project_name,
                row.filters?.from ? `${formatDate(row.filters.from)} – ${formatDate(row.filters.to)}` : null,
                `${row.user?.full_name ?? 'Unknown'} · ${formatDateTime(row.created_at)}`,
              ]
                .filter(Boolean)
                .join(' · ')
            }
          />
        ))}
      </Section>

      {picking && (
        <PickSheet
          title="Projects"
          hint="Tick one or more projects - or All projects."
          mode="multi"
          options={[
            { value: ALL, title: 'All projects' },
            ...projects.map((p) => ({ value: p.id, title: p.name, subtitle: p.status === 'active' ? undefined : 'Not active' })),
          ]}
          selected={chosen[picking].length ? chosen[picking] : [ALL]}
          onPick={(value) => toggle(picking, value)}
          onClose={() => setPicking(null)}
        />
      )}
    </Page>
  )
}

export default ExportsPage
