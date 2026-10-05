import { EMPLOYEE_CATEGORY_LABELS, EMPLOYEE_STATUS_LABELS } from '../labels.js'
import { hoursSplitColumns, paySplitColumns, rateColumns, rateValues, splitTotals } from './projectCost.js'
import {
  CONFIDENTIAL,
  HOURS,
  addTableSheet,
  call,
  createWorkbook,
  excelDate,
  exportFilename,
  num,
} from './workbook.js'

// Export 2: the payroll hours sheet, all projects (owners/admins only - the
// database returns nothing to anyone else). NOT a payslip: gross with
// overtime (per the pay rules), before deductions. Three sheets:
//   Payroll hours - approved people (now or before)
//   Daily grid    - those people down, the dates across, hours
//   Excluded      - people never approved, with their hours, so nobody is
//                   silently dropped
// Every figure and total comes from the database.

export const PAYROLL_HOURS = { type: 'payroll_hours', slug: 'payroll-hours', name: 'Payroll hours sheet' }
export const PAYROLL_WARNING = 'GROSS, BEFORE DEDUCTIONS — PROVISIONAL, NOT A PAYSLIP'

export async function fetchPayrollHours(client, { from, to }) {
  const [people, days] = await Promise.all([
    call(client, 'export_payroll', { p_from: from, p_to: to }),
    call(client, 'export_daily_hours', { p_project_id: null, p_from: from, p_to: to }),
  ])
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

//   meta: { company, from, to, generatedBy, generatedAt }
export function buildPayrollHours(data, meta) {
  const workbook = createWorkbook()
  const sheetMeta = { ...meta, projectName: 'All projects', report: `${PAYROLL_HOURS.name}` }
  const included = data.people.filter((person) => person.included)
  const excluded = data.people.filter((person) => !person.included)
  const totals = data.people[0] ?? {}
  const notes = [PAYROLL_WARNING, CONFIDENTIAL]

  // --- Payroll hours ------------------------------------------------------------
  addTableSheet(workbook, {
    name: 'Payroll hours',
    meta: sheetMeta,
    notes,
    columns: [
      { header: 'Employee', key: 'full_name', type: 'text', width: 24 },
      { header: 'Category', key: 'category_label', type: 'text', width: 16 },
      { header: 'Status', key: 'status_label', type: 'text', width: 11 },
      { header: 'Days worked', key: 'days', type: 'whole', width: 11 },
      { header: 'Hours', key: 'hours', type: 'hours', width: 10 },
      ...hoursSplitColumns(included),
      { header: 'Unpriced hours (no rate on the day)', key: 'unpriced_hours', type: 'hours', width: 16 },
      ...rateColumns(included),
      ...paySplitColumns(included),
      { header: 'Gross (provisional)', key: 'gross', type: 'money', width: 18 },
    ],
    rows: included.map((person) => ({ ...describe(person), ...rateValues(person) })),
    totals: {
      hours: totals.total_hours ?? 0,
      ...splitTotals(totals),
      unpriced_hours: totals.total_unpriced_hours ?? 0,
      gross: totals.total_gross ?? 0,
    },
  })

  // --- Daily grid: people down, dates across ------------------------------------
  const dates = datesBetween(meta.from, meta.to)
  const hoursOn = new Map(data.days.map((row) => [`${row.employee_id}|${row.day}`, row.hours]))
  const { sheet: grid, firstDataRow } = addTableSheet(workbook, {
    name: 'Daily grid',
    meta: sheetMeta,
    notes: [...notes, 'Hours on submitted reports. Approved people only - see the Excluded sheet for the rest.'],
    columns: [
      { header: 'Employee', key: 'full_name', type: 'text', width: 24 },
      ...dates.map((date) => ({ header: date, dateHeader: true, key: date, type: 'hours', width: 8 })),
      { header: 'Total hours', key: 'hours', type: 'hours', width: 11 },
    ],
    rows: included.map((person) => ({
      full_name: person.full_name,
      hours: person.hours,
      ...Object.fromEntries(dates.map((date) => [date, hoursOn.get(`${person.employee_id}|${date}`) ?? null])),
    })),
    // Each date's column total is worked out by Excel when the file opens;
    // the grand total is the database's.
    totals: { ...Object.fromEntries(dates.map((date) => [date, null])), hours: totals.total_hours ?? 0 },
  })
  // Each person's row total: a SUM across their days, carrying the
  // database's total for them.
  const lastDateColumn = grid.getColumn(dates.length + 1).letter
  included.forEach((person, index) => {
    const row = firstDataRow + index
    const cell = grid.getRow(row).getCell(dates.length + 2)
    cell.value = { formula: `SUM(B${row}:${lastDateColumn}${row})`, result: num(person.hours) }
    cell.numFmt = HOURS
  })

  // --- Excluded: never approved ---------------------------------------------------
  addTableSheet(workbook, {
    name: 'Excluded',
    meta: { ...sheetMeta, report: `${PAYROLL_HOURS.name}: Excluded — pending/unapproved employees` },
    notes: [
      'Excluded — pending/unapproved employees. Their hours are not on the payroll sheet until the owner approves them with a rate.',
      CONFIDENTIAL,
    ],
    columns: [
      { header: 'Employee', key: 'full_name', type: 'text', width: 24 },
      { header: 'Category', key: 'category_label', type: 'text', width: 16 },
      { header: 'Status', key: 'status_label', type: 'text', width: 11 },
      { header: 'Days worked', key: 'days', type: 'whole', width: 11 },
      { header: 'Hours', key: 'hours', type: 'hours', width: 10 },
    ],
    rows: excluded.map(describe),
    totals: { hours: totals.excluded_hours ?? 0 },
  })

  return {
    workbook,
    filename: exportFilename(PAYROLL_HOURS.slug, 'all projects', meta.from, meta.to),
  }
}
