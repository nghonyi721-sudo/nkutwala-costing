import { useEffect, useState } from 'react'
import { fetchHolidays, fetchRules, firstRule, ruleOn } from '../../../lib/payRules'
import { formatDate, todayLocal } from '../../../lib/labels'
import Button from '../../../components/Button'
import { NotePencilIcon, PlusIcon } from '../../../components/icons'
import Notice from '../../../components/Notice'
import Page from '../../../components/Page'
import { Row } from '../../../components/Row'
import Section from '../../../components/Section'
import SegmentedControl from '../../../components/SegmentedControl'
import Skeleton from '../../../components/Skeleton'
import StatusBadge from '../../../components/StatusBadge'
import { LOAD_ERROR } from '../drill/drillText'
import { AddHolidaySheet, VoidHolidaySheet } from './HolidaySheets'
import RuleForm from './RuleForm'
import RuleRows from './RuleRows'
import RuleSheet from './RuleSheet'
import { shortText } from './ruleText'

// Owner/admin: the pay rules (overtime, weekly overtime, Sundays, public
// holidays, the warning limits) and the public holidays. Rules are dated and
// never edited - a change is a new rule from a date; each day is worked out
// with the rule in force on that day. Holidays are added or voided.
//   onBack: shown as a pushed screen (from Pay runs); otherwise a main screen
function PayRulesPage({ onBack }) {
  const [rules, setRules] = useState(undefined)
  const [holidays, setHolidays] = useState(undefined)
  const [error, setError] = useState('')
  const [reloadCount, setReloadCount] = useState(0)
  const [year, setYear] = useState(null)

  const [editing, setEditing] = useState(false)
  // A sheet: { kind: 'rule', rule } | { kind: 'add-holiday' } | { kind: 'void-holiday', holiday }
  const [sheet, setSheet] = useState(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([fetchRules(), fetchHolidays()])
      .then(([ruleRows, holidayRows]) => {
        if (cancelled) return
        setError('')
        setRules(ruleRows)
        setHolidays(holidayRows)
      })
      .catch(() => {
        if (!cancelled) setError(LOAD_ERROR)
      })
    return () => {
      cancelled = true
    }
  }, [reloadCount])

  function reload() {
    setSheet(null)
    setEditing(false)
    setReloadCount((count) => count + 1)
  }

  const today = todayLocal()
  const inForce = ruleOn(rules, today)
  const first = firstRule(rules)

  if (editing) return <RuleForm base={inForce} onBack={() => setEditing(false)} onSaved={reload} />

  // Holidays by year; this year first if it has any.
  const years = [...new Set((holidays ?? []).map((holiday) => holiday.holiday_date.slice(0, 4)))].sort()
  const thisYear = today.slice(0, 4)
  const shownYear = year ?? (years.includes(thisYear) ? thisYear : years.at(-1))
  const shownHolidays = (holidays ?? []).filter((holiday) => holiday.holiday_date.startsWith(shownYear ?? ''))

  function ruleStatus(rule) {
    if (rule.voided_at) return { status: 'voided', label: 'Voided' }
    if (rule.id === inForce?.id) return { status: 'active', label: 'In force' }
    if (rule.effective_from > today) return { status: 'pending', label: 'Upcoming', tone: 'grey' }
    return { status: 'earlier', label: 'Earlier', tone: 'grey' }
  }

  return (
    <Page title="Pay rules" subtitle="And public holidays" onBack={onBack} backLabel="Pay runs">
      {error && <Notice tone="error">{error}</Notice>}
      {!error && rules === undefined && <Skeleton rows={5} />}

      {inForce && (
        <>
          <Section
            title="In force today"
            footer={`From ${formatDate(inForce.effective_from)}. Each day is worked out with the rule in force on that day - a change never alters earlier days.`}
          >
            <RuleRows rule={inForce} />
          </Section>
          <Section plain>
            <Button icon={NotePencilIcon} onClick={() => setEditing(true)}>
              Change the rules from a date
            </Button>
          </Section>
        </>
      )}

      {rules?.length > 0 && (
        <Section title="All rules" footer="Newest first. Tap one to see it or void it. Voided rules stay here, marked Voided.">
          {rules.map((rule) => {
            const badge = ruleStatus(rule)
            return (
              <Row
                key={rule.id}
                title={`From ${formatDate(rule.effective_from)}`}
                subtitle={rule.voided_at ? `Voided: ${rule.void_reason}` : shortText(rule)}
                trailing={<StatusBadge status={badge.status} label={badge.label} tone={badge.tone} />}
                chevron
                onClick={() => setSheet({ kind: 'rule', rule })}
              />
            )
          })}
        </Section>
      )}

      {holidays && (
        <>
          <Section title="Public holidays" plain>
            {years.length > 1 && (
              <SegmentedControl
                label="Year"
                options={Object.fromEntries(years.map((one) => [one, one]))}
                value={shownYear}
                onChange={setYear}
              />
            )}
          </Section>
          {inForce && !inForce.public_holiday_enabled && (
            <Notice tone="info">The public holiday rate is off: holidays are listed, but paid like any other day.</Notice>
          )}
          <Section footer="Tap a holiday to void it. A holiday on a day already in a closed or paid pay run can't change.">
            {shownHolidays.length === 0 && <Row title="No public holidays" />}
            {shownHolidays.map((holiday) => (
              <Row
                key={holiday.id}
                title={holiday.name}
                subtitle={holiday.voided_at ? `${formatDate(holiday.holiday_date)} · voided: ${holiday.void_reason}` : formatDate(holiday.holiday_date)}
                trailing={holiday.voided_at ? <StatusBadge status="voided" label="Voided" /> : undefined}
                chevron={!holiday.voided_at}
                onClick={holiday.voided_at ? undefined : () => setSheet({ kind: 'void-holiday', holiday })}
              />
            ))}
            <Row icon={PlusIcon} tone="accent" title="Add public holiday" onClick={() => setSheet({ kind: 'add-holiday' })} />
          </Section>
        </>
      )}

      {sheet?.kind === 'rule' && (
        <RuleSheet rule={sheet.rule} isFirst={sheet.rule.id === first?.id} onClose={() => setSheet(null)} onVoided={reload} />
      )}
      {sheet?.kind === 'add-holiday' && <AddHolidaySheet onClose={() => setSheet(null)} onSaved={reload} />}
      {sheet?.kind === 'void-holiday' && (
        <VoidHolidaySheet holiday={sheet.holiday} onClose={() => setSheet(null)} onSaved={reload} />
      )}
    </Page>
  )
}

export default PayRulesPage
