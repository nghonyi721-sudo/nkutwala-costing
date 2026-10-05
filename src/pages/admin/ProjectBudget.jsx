import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { REPORT_COST_CATEGORIES, formatDateTime, formatRand, parseRand } from '../../lib/labels'
import Button from '../../components/Button'
import { ClockCounterClockwiseIcon, CoinsIcon, WarningIcon } from '../../components/icons'
import Notice from '../../components/Notice'
import Page from '../../components/Page'
import { FieldRow, Row } from '../../components/Row'
import Section from '../../components/Section'
import Sheet, { SheetGroup } from '../../components/Sheet'
import Skeleton from '../../components/Skeleton'
import SummaryCard from '../../components/SummaryCard'
import MissingRates from './MissingRates'
import s from './ProjectBudget.module.css'

const hoursText = (hours) => `${Number(hours).toFixed(1)} h`

// Owner/admin: one project's money - budget vs spent for every category,
// hours that have no rate (never silently zero), and every budget change.
// It all comes from owner-only tables and views; site managers get nothing.
function ProjectBudget({ project, onBack }) {
  // undefined = loading, array = loaded (one row per category)
  const [rows, setRows] = useState(undefined)
  const [changes, setChanges] = useState([])
  const [loadError, setLoadError] = useState('')
  const [reloadCount, setReloadCount] = useState(0)
  const [showingMissing, setShowingMissing] = useState(false)

  const [editing, setEditing] = useState(null) // a category row
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState('')

  useEffect(() => {
    let cancelled = false

    Promise.all([
      supabase
        .from('project_cost_vs_budget')
        .select('category, category_label, budget, spent, remaining, percent_used, unpriced_hours')
        .eq('project_id', project.id)
        .order('sort_order'),
      supabase
        .from('budget_changes')
        .select('id, category, old_amount, new_amount, changed_at, changer:profiles(full_name)')
        .eq('project_id', project.id)
        .order('changed_at', { ascending: false })
        .limit(50),
    ]).then(([costResult, changeResult]) => {
      if (cancelled) return
      if (costResult.error || changeResult.error) {
        setLoadError('Could not load the costs. Check your signal and try again.')
      } else {
        setLoadError('')
        setRows(costResult.data)
        setChanges(changeResult.data)
      }
    })

    return () => {
      cancelled = true
    }
  }, [project.id, reloadCount])

  if (showingMissing) {
    return (
      <MissingRates
        projectId={project.id}
        backLabel="Budget"
        onBack={() => {
          setShowingMissing(false)
          setReloadCount((count) => count + 1)
        }}
      />
    )
  }

  function startEditing(row) {
    setEditing(row)
    setAmount(row.budget === null ? '' : String(Number(row.budget)))
    setSaveError('')
  }

  // Sets a category's budget: changes the existing line, or adds the first
  // one. The database logs every change itself.
  async function saveBudget() {
    const value = parseRand(amount, { allowZero: true })
    if (value === null) {
      setSaveError('Enter the budget in rand, for example 150000 or 150 000,00.')
      return
    }

    setSaveError('')
    setBusy(true)
    const change = () =>
      supabase
        .from('project_budgets')
        .update({ amount: value })
        .eq('project_id', project.id)
        .eq('category', editing.category)
        .select('id')
    let result =
      editing.budget === null
        ? await supabase
            .from('project_budgets')
            .insert({ project_id: project.id, category: editing.category, amount: value })
            .select('id')
        : await change()
    // Someone else set it first: change theirs instead.
    if (result.error?.code === '23505') result = await change()
    setBusy(false)

    if (result.error || result.data.length === 0) {
      setSaveError('Could not save the budget. Check your signal and try again.')
    } else {
      setEditing(null)
      setReloadCount((count) => count + 1)
    }
  }

  const labelOf = Object.fromEntries((rows ?? []).map((row) => [row.category, row.category_label]))
  const spent = (rows ?? []).reduce((sum, row) => sum + Number(row.spent), 0)
  const budgeted = (rows ?? []).filter((row) => row.budget !== null)
  const budgetTotal = budgeted.reduce((sum, row) => sum + Number(row.budget), 0)
  const unpriced = (rows ?? []).reduce((sum, row) => sum + Number(row.unpriced_hours), 0)
  const percentUsed = budgetTotal > 0 ? Math.round((1000 * spent) / budgetTotal) / 10 : null

  function categoryRow(row) {
    const rowSpent = Number(row.spent)
    const rowBudget = row.budget === null ? null : Number(row.budget)
    const over = rowBudget !== null && rowSpent > rowBudget
    const used = rowBudget > 0 ? Math.min(100, (100 * rowSpent) / rowBudget) : 0
    return (
      <Row
        key={row.category}
        title={row.category_label}
        subtitle={
          <>
            {rowBudget === null
              ? `${formatRand(rowSpent)} spent · no budget`
              : `${formatRand(rowSpent)} of ${formatRand(rowBudget)}`}
            {rowBudget !== null && (
              <span className={over ? `${s.line} ${s.overText}` : s.line}>
                {over ? `${formatRand(rowSpent - rowBudget)} over budget` : `${formatRand(rowBudget - rowSpent)} left`}
              </span>
            )}
            {Number(row.unpriced_hours) > 0 && (
              <span className={`${s.line} ${s.unpriced}`}>{hoursText(row.unpriced_hours)} unpriced</span>
            )}
            {rowBudget > 0 && (
              <span className={over ? `${s.bar} ${s.over}` : s.bar} aria-hidden="true">
                <span style={{ width: `${used}%` }} />
              </span>
            )}
          </>
        }
        mono
        trailing={
          rowBudget === null ? (
            <span className={s.setBudget}>Set budget</span>
          ) : row.percent_used === null ? (
            '–'
          ) : (
            <span className={over ? s.overText : s.percent}>{row.percent_used}%</span>
          )
        }
        chevron
        onClick={() => startEditing(row)}
      />
    )
  }

  return (
    <Page title={project.name} subtitle="Budget and costs" onBack={onBack} backLabel="Project">
      {loadError && <Notice tone="error">{loadError}</Notice>}
      {!loadError && rows === undefined && <Skeleton rows={4} />}

      {rows && (
        <>
          <SummaryCard
            icon={CoinsIcon}
            label="Spent (receipts incl. VAT)"
            meta={percentUsed === null ? 'No budget set' : `${percentUsed}% of budget`}
            value={formatRand(spent)}
          />

          {unpriced > 0 && (
            <Notice tone="error">
              <strong>{hoursText(unpriced)} unpriced</strong> - these hours have no rate on their date, so
              they are not in the totals above.
              <span className={s.noticeAction}>
                <Button variant="plain" inline icon={WarningIcon} onClick={() => setShowingMissing(true)}>
                  See missing rates
                </Button>
              </span>
            </Notice>
          )}

          <Section
            title="By category"
            footer={
              'Labour and owned plant: hours on submitted daily reports x the rate on that day. ' +
              'Everything else: approved receipts only - the total paid, incl. VAT. ' +
              'Rented plant hours and fuel litres are quantities only. Tap a category to set its budget.'
            }
          >
            {rows.map(categoryRow)}
            <Row
              tone="strong"
              title="Total"
              subtitle={budgeted.length > 0 ? `Budget ${formatRand(budgetTotal)}` : 'No budget set'}
              mono
              trailing={formatRand(spent)}
            />
          </Section>

          <Section title="Budget changes">
            {changes.length === 0 && <Row title="No budget set yet" subtitle="Every change will be listed here." />}
            {changes.map((change) => (
              <Row
                key={change.id}
                icon={ClockCounterClockwiseIcon}
                iconTone="grey"
                title={`${labelOf[change.category] ?? change.category}: ${
                  change.old_amount === null ? 'set to' : `${formatRand(change.old_amount)} →`
                } ${formatRand(change.new_amount)}`}
                subtitle={`${formatDateTime(change.changed_at)} · ${change.changer?.full_name ?? 'Unknown'}`}
                mono
              />
            ))}
          </Section>
        </>
      )}

      {editing && (
        <Sheet
          title={`${editing.category_label} budget`}
          hint={
            REPORT_COST_CATEGORIES.includes(editing.category)
              ? 'Compared with hours on submitted reports x their rates. Every change is kept in the history.'
              : 'Compared with approved receipts (totals paid, incl. VAT). Every change is kept in the history.'
          }
          cancelLabel="Cancel"
          showDone={false}
          onClose={() => setEditing(null)}
          footer={
            <Button busy={busy} onClick={saveBudget}>
              {busy ? 'Saving…' : 'Save budget'}
            </Button>
          }
        >
          <SheetGroup>
            <FieldRow
              icon={CoinsIcon}
              label="Budget (R)"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0,00"
              inputWidth="9rem"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </SheetGroup>
          {saveError && <Notice tone="error">{saveError}</Notice>}
        </Sheet>
      )}
    </Page>
  )
}

export default ProjectBudget
