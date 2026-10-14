import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { exportExpenses, exportPayroll } from '../../../lib/exports/run'
import { formatDate, todayLocal } from '../../../lib/labels'
import { addDays, fetchPayrollChecks, fortnights } from '../../../lib/payroll'
import Button from '../../../components/Button'
import DateTimeField from '../../../components/DateTimeField'
import { CalendarBlankIcon, DownloadSimpleIcon, MapPinIcon, ReceiptIcon } from '../../../components/icons'
import Notice from '../../../components/Notice'
import Page from '../../../components/Page'
import { Row } from '../../../components/Row'
import Section from '../../../components/Section'
import { PickSheet } from '../../../components/Sheet'

// "28 Aug – 10 Sept" for the list of fortnights under the dates.
const shortRange = ({ from, to }) => `${formatDate(from).replace(/ \d{4}$/, '')} – ${formatDate(to).replace(/ \d{4}$/, '')}`

// How the dates split into fortnights, e.g. "2 fortnights: 28 Aug – 10 Sep,
// 11 – 22 Sep" (the payroll file has a table for each).
function splitText(from, to) {
  if (!from || !to || from > to) return undefined
  const blocks = fortnights(from, to)
  if (blocks.length > 6) return `${blocks.length} fortnights (14 days each from the start date), one sheet per month.`
  const list = blocks.map(shortRange).join(', ')
  return blocks.length === 1 ? `1 fortnight: ${list}.` : `${blocks.length} fortnights: ${list}.`
}

// Owner/admin: the payroll and the expenses statement for one project and
// any dates (they don't have to follow calendar months). Every figure in
// the files comes from the database, which refuses anyone else; each
// download is logged. Before downloading, the screen shows anything that
// would make the files wrong: people with hours but no approved rate (the
// payroll can't be made until they're approved), reports still in draft
// and receipts still waiting for approval (left out of the files).
function PayrollPage() {
  const [projects, setProjects] = useState([])
  const [projectId, setProjectId] = useState('')
  const [picking, setPicking] = useState(false)
  // Opens on the fortnight ending today.
  const [from, setFrom] = useState(() => addDays(todayLocal(), -13))
  const [to, setTo] = useState(todayLocal)

  // The checks for one project and dates: { key, value }. value: null =
  // couldn't check, object = the checks.
  const [checked, setChecked] = useState({ key: '', value: undefined })
  // 'payroll' | 'expenses' while exporting
  const [busy, setBusy] = useState(null)
  const [message, setMessage] = useState({ tone: 'info', text: '' })

  const project = projects.find((p) => p.id === projectId) ?? null
  const datesProblem =
    !from || !to ? 'Choose a start and an end date.' : from > to ? 'The start date must be on or before the end date.' : ''

  useEffect(() => {
    supabase
      .from('projects')
      .select('id, name, status')
      .order('name')
      .then(({ data }) => setProjects(data ?? []))
  }, [])

  // Checked again whenever the project or dates change.
  const checkKey = projectId && !datesProblem ? `${projectId}|${from}|${to}` : ''
  useEffect(() => {
    if (!checkKey) return undefined
    let cancelled = false
    fetchPayrollChecks(projectId, from, to)
      .then((value) => {
        if (!cancelled) setChecked({ key: checkKey, value })
      })
      .catch(() => {
        if (!cancelled) setChecked({ key: checkKey, value: null })
      })
    return () => {
      cancelled = true
    }
  }, [checkKey, projectId, from, to])

  // undefined = still checking these dates
  const checks = checked.key === checkKey ? checked.value : undefined
  const unpriced = checks?.unpriced ?? []
  const ready = Boolean(project) && !datesProblem

  async function download(which) {
    setMessage({ tone: 'info', text: '' })
    setBusy(which)
    try {
      if (which === 'payroll') await exportPayroll({ project: { id: project.id, name: project.name }, from, to })
      else await exportExpenses({ project: { id: project.id, name: project.name }, from, to })
      setMessage({
        tone: 'info',
        text: `Saved: ${which === 'payroll' ? 'Payroll' : 'Expenses statement'}, ${project.name}, ${formatDate(from)} – ${formatDate(to)}.`,
      })
    } catch (error) {
      // The database's own reason (e.g. someone without a rate) when it gave one.
      setMessage({
        tone: 'error',
        text: error?.code === '23514' ? error.message : 'Could not export. Check your signal and try again.',
      })
    }
    setBusy(null)
  }

  return (
    <Page title="Payroll" subtitle="Excel files - confidential, they contain pay and personal information">
      {message.text && <Notice tone={message.tone}>{message.text}</Notice>}

      <Section title="Project">
        <Row
          icon={MapPinIcon}
          title={project?.name ?? 'Choose a project'}
          tone={project ? undefined : 'accent'}
          chevron
          onClick={() => setPicking(true)}
        />
      </Section>

      <Section title="Dates" footer={datesProblem || splitText(from, to)}>
        <Row
          icon={CalendarBlankIcon}
          title="Start date"
          trailing={<DateTimeField type="date" label="Start date" value={from} onChange={(e) => setFrom(e.target.value)} />}
        />
        <Row
          icon={CalendarBlankIcon}
          title="End date"
          trailing={<DateTimeField type="date" label="End date" value={to} onChange={(e) => setTo(e.target.value)} />}
        />
      </Section>

      {ready && checks === null && (
        <Notice tone="error">Could not check this project&apos;s reports. Check your signal and try again.</Notice>
      )}
      {ready && unpriced.length > 0 && (
        <Notice tone="error">
          The payroll can&apos;t be made yet:{' '}
          {unpriced.map((person) => `${person.full_name} (${Number(person.hours)} h)`).join(', ')}{' '}
          {unpriced.length === 1 ? 'has' : 'have'} hours here but no approved rate. Approve them with a rate in
          Employees first.
        </Notice>
      )}
      {ready && checks?.draft_reports > 0 && (
        <Notice tone="info">
          {checks.draft_reports} report{checks.draft_reports === 1 ? ' is' : 's are'} still in draft in these dates -
          only submitted reports are counted.
        </Notice>
      )}

      <Section
        plain
        footer="Hours from submitted daily reports: up to 8 h a day normal, the rest overtime at x1.5 (Sunday / public holiday reports all overtime), at each day's rate. UIF 1% for UIF-registered people only."
      >
        <Button
          icon={DownloadSimpleIcon}
          busy={busy === 'payroll'}
          disabled={!ready || Boolean(busy) || checks === undefined || unpriced.length > 0}
          onClick={() => download('payroll')}
        >
          {busy === 'payroll' ? 'Exporting…' : 'Download payroll'}
        </Button>
      </Section>

      {ready && checks?.receipts_waiting > 0 && (
        <Notice tone="info">
          {checks.receipts_waiting} receipt{checks.receipts_waiting === 1 ? ' is' : 's are'} still waiting for approval
          in these dates - only approved expenses are listed.
        </Notice>
      )}
      <Section plain footer="Approved expenses only, oldest first, with totals by category. Amounts are VAT inclusive.">
        <Button
          variant="secondary"
          icon={ReceiptIcon}
          busy={busy === 'expenses'}
          disabled={!ready || Boolean(busy)}
          onClick={() => download('expenses')}
        >
          {busy === 'expenses' ? 'Exporting…' : 'Download expenses statement'}
        </Button>
      </Section>

      {picking && (
        <PickSheet
          title="Project"
          options={projects.map((p) => ({ value: p.id, title: p.name, subtitle: p.status === 'active' ? undefined : 'Not active' }))}
          selected={projectId}
          onPick={setProjectId}
          onClose={() => setPicking(false)}
        />
      )}
    </Page>
  )
}

export default PayrollPage
