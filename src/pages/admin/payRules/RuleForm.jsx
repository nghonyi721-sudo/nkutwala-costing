import { useState } from 'react'
import { addRule, ruleError } from '../../../lib/payRules'
import { formatDate, todayLocal } from '../../../lib/labels'
import ActionBar from '../../../components/ActionBar'
import Button from '../../../components/Button'
import DateTimeField from '../../../components/DateTimeField'
import { CalendarBlankIcon, CheckCircleIcon } from '../../../components/icons'
import Notice from '../../../components/Notice'
import Page from '../../../components/Page'
import { Row, SwitchRow } from '../../../components/Row'
import Section from '../../../components/Section'
import Stepper from '../../../components/Stepper'

// A NEW pay rule from a date, filled in with the rule in force (base). Rules
// are never edited: saving adds a rule; the old one stays for the days
// before. Big steppers, no typing. The database refuses a rule that would
// change days already in a closed or paid pay run.
function RuleForm({ base, onBack, onSaved }) {
  const [form, setForm] = useState(() => ({
    effective_from: todayLocal(),
    daily_ot_threshold_hours: Number(base?.daily_ot_threshold_hours ?? 8),
    ot_multiplier: Number(base?.ot_multiplier ?? 1.5),
    weekly_ot_enabled: Boolean(base?.weekly_ot_enabled),
    weekly_ot_threshold_hours: Number(base?.weekly_ot_threshold_hours ?? 45),
    sunday_enabled: Boolean(base?.sunday_enabled),
    sunday_multiplier: Number(base?.sunday_multiplier ?? 2),
    public_holiday_enabled: Boolean(base?.public_holiday_enabled),
    public_holiday_multiplier: Number(base?.public_holiday_multiplier ?? 2),
    warn_weekly_ot_hours: Number(base?.warn_weekly_ot_hours ?? 10),
    warn_daily_hours: Number(base?.warn_daily_hours ?? 12),
  }))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (field) => (value) => setForm((current) => ({ ...current, [field]: value }))

  async function save() {
    if (!form.effective_from) {
      setError('Choose the date the rule starts.')
      return
    }
    setError('')
    setBusy(true)
    try {
      await addRule(form)
      onSaved()
    } catch (saveError) {
      setError(ruleError(saveError, { kind: 'rule', date: form.effective_from }))
      setBusy(false)
    }
  }

  return (
    <Page
      title="New pay rule"
      subtitle="Applies from the date you choose"
      onBack={onBack}
      backLabel="Pay rules"
      footer={
        <ActionBar message={error} tone="error">
          <Button icon={CheckCircleIcon} busy={busy} onClick={save}>
            {busy ? 'Saving…' : 'Save rule'}
          </Button>
        </ActionBar>
      }
    >
      <Section footer={`Days from ${formatDate(form.effective_from || todayLocal())} are worked out with these rules. Earlier days keep their own rule.`}>
        <Row
          icon={CalendarBlankIcon}
          title="Starts"
          trailing={
            <DateTimeField type="date" label="Starts" value={form.effective_from} onChange={(e) => set('effective_from')(e.target.value)} />
          }
        />
      </Section>

      <Section title="Overtime">
        <Row
          title="After"
          subtitle="hours a day"
          trailing={<Stepper label="Overtime after" value={form.daily_ot_threshold_hours} min={1} max={24} unit="h" onChange={set('daily_ot_threshold_hours')} />}
        />
        <Row
          title="Rate"
          subtitle="times the hourly rate"
          trailing={<Stepper label="Overtime rate" value={form.ot_multiplier} min={1} max={5} unit="×" onChange={set('ot_multiplier')} />}
        />
      </Section>

      <Section title="Weekly overtime" footer="Ordinary hours over the weekly limit (Monday to Sunday) become overtime too.">
        <SwitchRow title="Weekly overtime" checked={form.weekly_ot_enabled} onChange={set('weekly_ot_enabled')} />
        {form.weekly_ot_enabled && (
          <Row
            title="After"
            subtitle="hours a week"
            trailing={
              <Stepper label="Weekly overtime after" value={form.weekly_ot_threshold_hours} step={1} min={1} max={168} unit="h" onChange={set('weekly_ot_threshold_hours')} />
            }
          />
        )}
      </Section>

      <Section title="Sundays" footer="Every hour on a Sunday at this rate (a public holiday wins over a Sunday).">
        <SwitchRow title="Sunday rate" checked={form.sunday_enabled} onChange={set('sunday_enabled')} />
        {form.sunday_enabled && (
          <Row
            title="Rate"
            trailing={<Stepper label="Sunday rate" value={form.sunday_multiplier} min={1} max={5} unit="×" onChange={set('sunday_multiplier')} />}
          />
        )}
      </Section>

      <Section title="Public holidays" footer="Every hour on a public holiday (from the holiday list) at this rate.">
        <SwitchRow title="Public holiday rate" checked={form.public_holiday_enabled} onChange={set('public_holiday_enabled')} />
        {form.public_holiday_enabled && (
          <Row
            title="Rate"
            trailing={
              <Stepper label="Public holiday rate" value={form.public_holiday_multiplier} min={1} max={5} unit="×" onChange={set('public_holiday_multiplier')} />
            }
          />
        )}
      </Section>

      <Section title="Warnings" footer="Warnings only - hours are never blocked. Shown on the dashboard and on a person's days.">
        <Row
          title="Overtime a week"
          subtitle="warn when over"
          trailing={<Stepper label="Warn over overtime a week" value={form.warn_weekly_ot_hours} step={1} min={1} max={60} unit="h" onChange={set('warn_weekly_ot_hours')} />}
        />
        <Row
          title="Hours in a day"
          subtitle="warn when over"
          trailing={<Stepper label="Warn over hours a day" value={form.warn_daily_hours} min={1} max={24} unit="h" onChange={set('warn_daily_hours')} />}
        />
      </Section>

      {error && <Notice tone="error">{error}</Notice>}
    </Page>
  )
}

export default RuleForm
