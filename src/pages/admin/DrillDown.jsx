import { useState } from 'react'
import Breadcrumbs from '../../components/Breadcrumbs'
import EmployeeReview from './EmployeeReview'
import ReportView from './ReportView'
import EmployeeDaysLevel from './drill/EmployeeDaysLevel'
import HoursLevel from './drill/HoursLevel'
import { MachineRates, PersonRates } from './drill/RateScreens'
import ReceiptsLevel from './drill/ReceiptsLevel'
import SpendingLevel from './drill/SpendingLevel'
import UnpricedLevel from './drill/UnpricedLevel'

const LEVELS = {
  spending: SpendingLevel,
  hours: HoursLevel,
  receipts: ReceiptsLevel,
  unpriced: UnpricedLevel,
  employee: EmployeeDaysLevel,
}

// Owner/admin: the dashboard drill-down - from a figure to the line items
// behind it, to a person, to a day's report. Keeps the stack of levels
// (see drill/levels.js): Back goes up one, and the breadcrumbs jump straight
// to any earlier level. Every level's total comes from the database and
// equals the figure tapped. Nothing is stored on the device.
//   start:  the level opened from the dashboard
//   onExit: back to the dashboard (its filters are kept)
function DrillDown({ start, onExit }) {
  const [stack, setStack] = useState([start])
  // Bumped after approving someone or setting a rate, so levels reload.
  const [reloadCount, setReloadCount] = useState(0)

  const level = stack.at(-1)
  const depth = stack.length

  const crumbs = [
    { label: 'Dashboard', onClick: onExit },
    ...stack.map((item, index) => ({
      label: item.label,
      onClick: index < depth - 1 ? () => setStack((current) => current.slice(0, index + 1)) : undefined,
    })),
  ]
  const nav = {
    crumbs,
    backLabel: crumbs.at(-2).label,
    back: () => (depth > 1 ? setStack((current) => current.slice(0, -1)) : onExit()),
    // A level opened from here is about the same project (its name is kept
    // for exports).
    open: (next) => setStack((current) => [...current, { projectName: level.projectName, ...next }]),
    reloadCount,
    // What the Export button exports: this level's project and period.
    exportScope: level.period ? { projectId: level.projectId, projectName: level.projectName, period: level.period } : null,
  }
  // After an approve / set-rate screen: back to the level below, reloaded.
  const done = () => {
    setStack((current) => current.slice(0, -1))
    setReloadCount((count) => count + 1)
  }

  const key = `${depth}-${level.kind}`

  if (level.kind === 'report') {
    return (
      <ReportView
        key={key}
        reportId={level.reportId}
        readOnly
        backLabel={nav.backLabel}
        onBack={nav.back}
        breadcrumbs={<Breadcrumbs steps={crumbs} />}
      />
    )
  }
  if (level.kind === 'approve') {
    return <EmployeeReview key={key} employeeId={level.employeeId} backLabel={nav.backLabel} onDone={done} />
  }
  if (level.kind === 'employee-rates') {
    return (
      <PersonRates key={key} employeeId={level.employeeId} name={level.label} backLabel={nav.backLabel} onDone={done} />
    )
  }
  if (level.kind === 'machine-rates') {
    return (
      <MachineRates key={key} equipmentId={level.equipmentId} name={level.label} backLabel={nav.backLabel} onDone={done} />
    )
  }

  const Level = LEVELS[level.kind]
  return <Level key={key} level={level} nav={nav} />
}

export default DrillDown
