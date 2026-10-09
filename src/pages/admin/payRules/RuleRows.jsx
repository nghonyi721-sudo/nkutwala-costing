import { CalendarBlankIcon, ClockIcon, CoinsIcon, TagIcon, WarningIcon } from '../../../components/icons'
import { Row } from '../../../components/Row'
import { holidayText, overtimeText, sundayText, warningsText, weeklyText } from './ruleText'

// A pay rule's settings, one row each (inside a Section or SheetGroup).
function RuleRows({ rule }) {
  return (
    <>
      <Row icon={ClockIcon} title="Overtime" subtitle={overtimeText(rule)} />
      <Row icon={CalendarBlankIcon} iconTone={rule.weekly_ot_enabled ? 'blue' : 'grey'} title="Weekly overtime" subtitle={weeklyText(rule)} />
      <Row icon={CoinsIcon} iconTone={rule.sunday_enabled ? 'blue' : 'grey'} title="Sundays" subtitle={sundayText(rule)} />
      <Row icon={TagIcon} iconTone={rule.public_holiday_enabled ? 'blue' : 'grey'} title="Public holidays" subtitle={holidayText(rule)} />
      <Row icon={WarningIcon} iconTone="grey" title="Warnings (never block)" subtitle={warningsText(rule)} />
    </>
  )
}

export default RuleRows
