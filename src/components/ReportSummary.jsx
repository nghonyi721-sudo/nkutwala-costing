import { formatDate, formatDateTime, formatTime, hoursBetween } from '../lib/labels'
import { totalHours } from '../lib/reports'
import SummaryCard from './SummaryCard'
import {
  CalendarBlankIcon,
  CheckCircleIcon,
  ClipboardTextIcon,
  ClockIcon,
  CloudRainIcon,
  GasPumpIcon,
  HardHatIcon,
  HourglassIcon,
  ListChecksIcon,
  UserCircleIcon,
  UsersThreeIcon,
  WarningIcon,
} from './icons'
import Notice from './Notice'
import { Row } from './Row'
import Section from './Section'
import StatusBadge from './StatusBadge'
import s from './ReportSummary.module.css'

// alert: a "yes" is a warning (shown red), not a box ticked.
const SAFETY_ITEMS = [
  { key: 'dsti_done', label: 'DSTI done', icon: ListChecksIcon },
  { key: 'internal_audit', label: 'Internal audit', icon: ClipboardTextIcon },
  { key: 'near_miss', label: 'Near miss', icon: WarningIcon, alert: true },
  { key: 'safety_moment', label: 'Safety moment', icon: HardHatIcon },
]

const hours = (value) => `${Number(value).toFixed(1)} h`

// Read-only view of one report (from fetchReport). Used by the site manager
// for submitted reports and by owners for every report. Quantities only.
function ReportSummary({ report }) {
  const crew = report.report_crew ?? []
  const equipment = report.report_equipment ?? []
  const onSite = hoursBetween(report.start_time, report.end_time)

  return (
    <>
      <SummaryCard
        icon={UsersThreeIcon}
        label="Man-hours"
        meta={<StatusBadge status={report.status} />}
        value={totalHours(crew).toFixed(1)}
        unit="h"
        figures={[
          { label: 'Crew', value: crew.length },
          { label: 'Plant hours', value: totalHours(equipment).toFixed(1), unit: 'h' },
          { label: 'Fuel', value: Number(report.fuel_litres).toFixed(0), unit: 'L' },
          { label: 'Rain', value: report.rain_percent, unit: '%' },
        ]}
      />

      {report.reopened_at && (
        <Notice tone="info">
          Reopened {formatDateTime(report.reopened_at)}
          {report.reopener?.full_name ? ` by ${report.reopener.full_name}` : ''}.
          <br />
          Reason: {report.reopen_reason}
        </Notice>
      )}

      <Section title="Details">
        <Row icon={CalendarBlankIcon} iconTone="grey" title="Date" trailing={formatDate(report.report_date)} />
        {report.reporter?.full_name && (
          <Row
            icon={UserCircleIcon}
            iconTone="grey"
            title="Site manager"
            trailing={report.reporter.full_name}
          />
        )}
        <Row
          icon={CheckCircleIcon}
          iconTone="grey"
          title="Status"
          trailing={<StatusBadge status={report.status} />}
        />
        {report.submitted_at && (
          <Row
            icon={ClockIcon}
            iconTone="grey"
            title="Submitted"
            trailing={formatDateTime(report.submitted_at)}
          />
        )}
      </Section>

      <Section title="Times" footer={onSite ? `${onSite.toFixed(1)} hours on site` : undefined}>
        <Row icon={ClockIcon} title="Start" trailing={formatTime(report.start_time)} />
        <Row icon={ClockIcon} title="End" trailing={formatTime(report.end_time)} />
      </Section>

      <Section title={`Crew · ${crew.length}`}>
        {crew.length === 0 && <Row title="No crew recorded" />}
        {crew.map((line) => (
          <Row key={line.id} title={line.employee?.full_name} trailing={hours(line.hours)} />
        ))}
        <Row tone="strong" title="Total man-hours" trailing={hours(totalHours(crew))} />
      </Section>

      <Section title={`Equipment · ${equipment.length}`}>
        {equipment.length === 0 && <Row title="No equipment recorded" />}
        {equipment.map((line) => (
          <Row key={line.id} title={line.equipment?.name} trailing={hours(line.hours)} />
        ))}
        <Row tone="strong" title="Plant hours" trailing={hours(totalHours(equipment))} />
      </Section>

      <Section title="Conditions">
        <Row icon={GasPumpIcon} title="Fuel" trailing={`${Number(report.fuel_litres).toFixed(1)} L`} />
        <Row icon={CloudRainIcon} title="Rain" trailing={`${report.rain_percent}%`} />
        <Row icon={HourglassIcon} title="Delay" trailing={hours(report.delay_hours)} />
      </Section>

      <Section title="Safety">
        {SAFETY_ITEMS.map((item) => (
          <Row
            key={item.key}
            icon={item.icon}
            iconTone={item.alert ? 'red' : 'blue'}
            title={item.label}
            trailing={
              report[item.key] ? (
                <StatusBadge status={item.alert ? 'alert' : 'active'} label="Yes" />
              ) : (
                'No'
              )
            }
          />
        ))}
      </Section>

      <Section title="Activities">
        <p className={s.activities}>{report.activities || 'None recorded.'}</p>
      </Section>
    </>
  )
}

export default ReportSummary
