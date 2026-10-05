import { EMPLOYEE_CATEGORY_LABELS, EMPLOYEE_STATUS_LABELS } from '../labels.js'
import {
  hoursSplitColumns,
  paySplitColumns,
  projectColumn,
  projectIdsOf,
  rateColumns,
  rateValues,
  splitTotals,
} from './projectCost.js'
import {
  ALLOCATION_OT_NOTE,
  CONFIDENTIAL,
  HOURS,
  PAY_ONLY_UNFILTERED,
  addTableSheet,
  call,
  createWorkbook,
  excelDate,
  exportFilename,
  isFiltered,
  num,
  payTitle,
  projectGroups,
} from './workbook.js'

// Export 2: the payroll hours sheet (owners/admins only - the database
// returns nothing to anyone else). NOT a payslip. Three sheets:
//   Payroll hours - approved people (now or before)
//   Daily grid    - those people down, the dates across, hours
//   Excluded      - people never approved, with their hours, so nobody is
//                   silently dropped
// Two versions:
//   All projects     - each person's FULL pay: gross with overtime (per the
//                      pay rules), before deductions. "GROSS BEFORE
//                      DEDUCTIONS — NOT A PAYSLIP".
//   Chosen projects  - a PROJECT LABOUR COST ALLOCATION: only those
//                      projects' share of each person's pay (overtime as
//                      allocated). "NOT THE AMOUNT TO PAY EMPLOYEES".
// Every figure, subtotal and total comes from the database.

export const PAYROLL_HOURS = { type: 'payroll_hours', slug: 'payroll-hours', name: 'Payroll hours sheet' }
export const LABOUR_ALLOCATION = { slug: 'labour-allocation', name: 'Project labour cost allocation' }
export const PROVISIONAL_PAY_NOTE = 'Provisional: from the submitted reports as they are now - not a closed pay run.'

//   projects: null (all projects) or [{ id, name }]; from/to: "YYYY-MM-DD"
export async function fetchPayrollHours(client, { projects, from, to }) {
  const args = { p_project_ids: projectIdsOf(projects), p_from: from, p_to: to }
  const [people, days] = await Promise.all([call(client, 'export_payroll', args), call(client, 'export_daily_hours', args)])
  return { people, days }
}

// Every date from..to, "YYYY-MM-DD" (the grid's columns).
function datesBetween(from, to) {
  const dates = []
  for (let day = excelDate(from); day <= excelDate(to); day = new Date(day.getTime() + 86400000)) {
    dates.push(day.toISOString().slice(0, 10))
  }
  return dates
}

const describe = (person) => ({
  ...person,
  category_label: EMPLOYEE_CATEGORY_LABELS[person.category] ?? person.category,
  status_label: EMPLOYEE_STATUS_LABELS[person.status] ?? person.status,
})

//   meta: { company, projects, from, to, generatedBy, generatedAt }
//         projects: null (all projects) or [{ id, name }]
export function buildPayrollHours(data, meta) {
  const workbook = createWorkbook()
  const allocation = isFiltered(meta.projects)
  const kind = allocation ? LABOUR_ALLOCATION : PAYROLL_HOURS
  const sheetMeta = { ...meta, banner: payTitle(meta.projects), report: kind.name }
  const included = data.people.filter((person) => person.included)
  const excluded = data.people.filter((person) => !person.included)
  const totals = data.people[0] ?? {}
  const notes = allocation
    ? [PAY_ONLY_UNFILTERED, ALLOCATION_OT_NOTE, PROVISIONAL_PAY_NOTE, CONFIDENTIAL]
    : [PAY_ONLY_UNFILTERED, PROVISIONAL_PAY_NOTE, CONFIDENTIAL]
  // The Project column: the row's project, or (all projects) the projects
  // each person worked on.
  const project = projectColumn(allocation ? 'Project' : 'Projects worked')

  // --- Payroll hours ------------------------------------------------------------
  addTableSheet(workbook, {
    name: allocation ? 'Labour allocation' : 'Payroll hours',
    meta: sheetMeta,
    notes,
    columns: [
      { header: 'Employee', key: 'full_name', type: 'text', width: 24 },
      project,
      { header: 'Category', key: 'category_label', type: 'text', width: 16 },
      { header: 'Status', key: 'status_label', type: 'text', width: 11 },
      { header: 'Days worked', key: 'days', type: 'whole', width: 11 },
      { header: 'Hours', key: 'hours', type: 'hours', width: 10 },
      ...hoursSplitColumns(included),
      { header: 'Unpriced hours (no rate on the day)', key: 'unpriced_hours', type: 'hours', width: 16 },
      ...rateColumns(included),
      ...paySplitColumns(included),
      allocation
        ? { header: 'Allocated labour cost', key: 'gross', type: 'money', width: 18 }
        : { header: 'Gross (provisional)', key: 'gross', type: 'money', width: 18 },
    ],
    rows: included.map((person) => ({ ...describe(person), ...rateValues(person) })),
    totals: {
      hours: totals.total_hours ?? 0,
      ...splitTotals(totals),
      unpriced_hours: totals.total_unpriced_hours ?? 0,
      gross: totals.total_gross ?? 0,
    },
    groups: projectGroups(meta.projects, (row) => ({
      hours: row.project_total_hours ?? 0,
      ...splitTotals(row, 'project_total'),
      unpriced_hours: row.project_total_unpriced_hours ?? 0,
      gross: row.project_total_gross ?? 0,
    })),
  })

  // --- Daily grid: people down, dates across ------------------------------------
  // One row per person (all projects) or per person per project.
  const dates = datesBetween(meta.from, meta.to)
  const rowKey = (row) => `${row.employee_id}|${row.project_id ?? ''}`
  const hoursOn = new Map(data.days.map((row) => [`${rowKey(row)}|${row.day}`, row.hours]))
  const { sheet: grid, written } = addTableSheet(workbook, {
    name: 'Daily grid',
    meta: sheetMeta,
    notes: [...notes, 'Hours on submitted reports. Approved people only - see the Excluded sheet for the rest.'],
    columns: [
      { header: 'Employee', key: 'full_name', type: 'text', width: 24 },
      project,
      ...dates.map((date) => ({ header: date, dateHeader: true, key: date, type: 'hours', width: 8 })),
      { header: 'Total hours', key: 'hours', type: 'hours', width: 11 },
    ],
    rows: included.map((person) => ({
      full_name: person.full_name,
      project_id: person.project_id,
      project_name: person.project_name,
      hours: person.hours,
      project_total_hours: person.project_total_hours,
      ...Object.fromEntries(dates.map((date) => [date, hoursOn.get(`${rowKey(person)}|${date}`) ?? null])),
    })),
    // Each date's column total is worked out by Excel when the file opens;
    // the hours totals are the database's.
    totals: { ...Object.fromEntries(dates.map((date) => [date, null])), hours: totals.total_hours ?? 0 },
    groups: projectGroups(meta.projects, (row) => ({ hours: row.project_total_hours ?? 0 })),
  })
  // Each row's total: a SUM across its days, carrying the database's hours.
  const firstDateColumn = grid.getColumn(3).letter
  const lastDateColumn = grid.getColumn(dates.length + 2).letter
  for (const { row, number } of written) {
    const cell = grid.getRow(number).getCell(dates.length + 3)
    cell.value = { formula: `SUM(${firstDateColumn}${number}:${lastDateColumn}${number})`, result: num(row.hours) }
    cell.numFmt = HOURS
  }

  // --- Excluded: never approved ---------------------------------------------------
  addTableSheet(workbook, {
    name: 'Excluded',
    meta: { ...sheetMeta, report: `${kind.name}: Excluded — pending/unapproved employees` },
    notes: [
      'Excluded — pending/unapproved employees. Their hours are not on the payroll sheet until the owner approves them with a rate.',
      CONFIDENTIAL,
    ],
    columns: [
      { header: 'Employee', key: 'full_name', type: 'text', width: 24 },
      project,
      { header: 'Category', key: 'category_label', type: 'text', width: 16 },
      { header: 'Status', key: 'status_label', type: 'text', width: 11 },
      { header: 'Days worked', key: 'days', type: 'whole', width: 11 },
      { header: 'Hours', key: 'hours', type: 'hours', width: 10 },
    ],
    rows: excluded.map(describe),
    totals: { hours: totals.excluded_hours ?? 0 },
    groups: projectGroups(meta.projects, (row) => ({ hours: row.project_excluded_hours ?? 0 })),
  })

  return {
    workbook,
    filename: exportFilename(kind.slug, meta.projects, meta.from, meta.to),
  }
}
