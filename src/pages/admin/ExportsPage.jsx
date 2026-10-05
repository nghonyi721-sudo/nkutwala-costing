import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { fetchPeriod } from '../../lib/dashboard'
import { exportPayrollHours, exportProjectCost } from '../../lib/exports/run'
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

// The dates of a chosen period: a preset (worked out by the database, like
// the dashboard's) or the dates picked. Returns { from, to } or a problem.
async function resolvePeriod(preset, projectId, custom) {
  if (preset !== 'custom') {
    const period = await fetchPeriod(preset, projectId)
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
// anyone else. Each export is logged (who, which report, filters, when).
function ExportsPage() {
  const [projects, setProjects] = useState([])
  const [pickingProject, setPickingProject] = useState(false)

  const [costProject, setCostProject] = useState(ALL)
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

  const project = projects.find((p) => p.id === costProject)

  async function run(which) {
    setMessage({ tone: 'info', text: '' })
    const projectId = which === 'cost' && costProject !== ALL ? costProject : null
    setBusy(which)
    try {
      const period =
        which === 'cost'
          ? await resolvePeriod(costPreset, projectId, costDates)
          : await resolvePeriod(payPreset, null, payDates)
      if (period.problem) {
        setMessage({ tone: 'error', text: period.problem })
      } else {
        if (which === 'cost') {
          await exportProjectCost({ projectId, projectName: project?.name ?? null, ...period })
        } else {
          await exportPayrollHours(period)
        }
        setMessage({
          tone: 'info',
          text: `Saved: ${EXPORT_LABELS[which === 'cost' ? 'project_cost' : 'payroll_hours']}, ${formatDate(period.from)} – ${formatDate(period.to)}.`,
        })
        setLogCount((count) => count + 1)
      }
    } catch {
      setMessage({ tone: 'error', text: 'Could not export. Check your signal and try again.' })
    }
    setBusy(null)
  }

  return (
    <Page title="Exports" subtitle="Excel files - confidential, they contain personal information">
      {message.text && <Notice tone={message.tone}>{message.text}</Notice>}

      {/* Project cost report: project, period, (dates), download */}
      <Section title="Project cost report">
        <Row
          icon={MapPinIcon}
          title="Project"
          trailing={project?.name ?? 'All projects'}
          chevron
          onClick={() => setPickingProject(true)}
        />
      </Section>
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
        footer="Summary by category, labour per person with rates, approved receipts and spend per week. Matches the dashboard."
      >
        <Button icon={DownloadSimpleIcon} busy={busy === 'cost'} disabled={Boolean(busy)} onClick={() => run('cost')}>
          {busy === 'cost' ? 'Exporting…' : 'Download Excel'}
        </Button>
      </Section>

      {/* Payroll hours sheet: period, (dates), download */}
      <Section title="Payroll hours sheet" plain>
        <SegmentedControl label="Payroll period" options={PAYROLL_PERIODS} value={payPreset} onChange={setPayPreset} />
      </Section>
      {payPreset === 'custom' && (
        <Section>
          <CustomDates value={payDates} onChange={setPayDates} />
        </Section>
      )}
      <Section
        plain
        footer="All projects. Gross at a flat rate, before deductions and overtime - provisional, NOT a payslip. People not yet approved are listed separately."
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
            title={EXPORT_LABELS[row.report_type] ?? row.report_type}
            subtitle={
              [
                row.filters?.project_name,
                row.filters?.from ? `${formatDate(row.filters.from)} – ${formatDate(row.filters.to)}` : null,
                `${row.user?.full_name ?? 'Unknown'} · ${formatDateTime(row.created_at)}`,
              ]
                .filter(Boolean)
                .join(' · ')
            }
          />
        ))}
      </Section>

      {pickingProject && (
        <PickSheet
          title="Project"
          options={[
            { value: ALL, title: 'All projects' },
            ...projects.map((p) => ({ value: p.id, title: p.name, subtitle: p.status === 'active' ? undefined : 'Not active' })),
          ]}
          selected={costProject}
          onPick={setCostProject}
          onClose={() => setPickingProject(false)}
        />
      )}
    </Page>
  )
}

export default ExportsPage
