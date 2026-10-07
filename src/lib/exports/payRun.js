import { EMPLOYEE_CATEGORY_LABELS, formatDate, formatDateTime } from '../labels.js'
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
  datesBetween,
  exportFilename,
  isFiltered,
  num,
  payTitle,
  projectGroups,
} from './workbook.js'

// The pay-run Excel: one version of a closed pay period, from the SNAPSHOT
// saved when it was closed (it never changes). Owners/admins only - the
// database returns nothing to anyone else. Four sheets:
//   Summary    - the run's totals (per project when filtered)
//   Pay run    - per person: hours, overtime, late hours, rates, pay, gross
//   Daily grid - people down, the period's dates across, late hours apart
//   Excluded   - pending people (no rate yet): their hours, paid later
// All projects: each person's full pay - "GROSS BEFORE DEDUCTIONS — NOT A
// PAYSLIP". Chosen projects: only those projects' share (the frozen project
// split) - "PROJECT LABOUR COST ALLOCATION — NOT THE AMOUNT TO PAY
// EMPLOYEES". Every figure, subtotal and total comes from the database.

export const PAY_RUN = { type: 'pay_run', name: 'Pay run' }
export const SUPERSEDED_NOTE = 'SUPERSEDED — DO NOT PAY FROM THIS VERSION'

//   runId: the pay run (one version); projects: null (all) or [{ id, name }]
export async function fetchPayRun(client, { runId, projects }) {
  const args = { p_run_id: runId, p_project_ids: projectIdsOf(projects) }
  const [people, days] = await Promise.all([call(client, 'pay_run_people', args), call(client, 'pay_run_grid', args)])
  return { people, days }
}

// "Version 2 · closed 5 Oct 2026, 10:10 by Thandi · paid 6 Oct 2026"
function runLine(run) {
  return [
    `Version ${run.version}`,
    run.closed_at ? `closed ${formatDateTime(run.closed_at)}${run.closed_by_name ? ` by ${run.closed_by_name}` : ''}` : null,
    run.paid_on ? `paid ${formatDate(run.paid_on)}` : 'not paid yet',
  ]
    .filter(Boolean)
    .join(' · ')
}

const describe = (row) => ({
  ...row,
  category_label: EMPLOYEE_CATEGORY_LABELS[row.employee_category] ?? row.employee_category,
})

//   meta: { company, generatedBy, generatedAt, projects, from, to, run }
//         from/to: the period's dates; projects: null (all) or [{ id, name }]
//         run: { version, status, closed_at, closed_by_name, paid_on,
//                superseded_at, superseded_reason } (from pay_run_versions)
export function buildPayRun(data, meta) {
  const workbook = createWorkbook()
  const { run } = meta
  const allocation = isFiltered(meta.projects)
  const name = allocation ? 'Pay run: project labour cost allocation' : 'Pay run'
  const sheetMeta = { ...meta, banner: payTitle(meta.projects), report: `${name} — version ${run.version}` }
  const included = data.people.filter((row) => row.included)
  const excluded = data.people.filter((row) => !row.included)
  const totals = data.people[0] ?? {}
  const superseded =
    run.status === 'superseded'
      ? [`${SUPERSEDED_NOTE} (${formatDateTime(run.superseded_at)}: ${run.superseded_reason})`]
      : []
  const notes = [...superseded, PAY_ONLY_UNFILTERED, ...(allocation ? [ALLOCATION_OT_NOTE] : []), runLine(run), CONFIDENTIAL]
  const money = allocation
    ? { header: 'Allocated labour cost', key: 'gross', type: 'money', width: 18 }
    : { header: 'Gross', key: 'gross', type: 'money', width: 16 }
  const project = projectColumn(allocation ? 'Project' : 'Projects worked')

  // --- Summary: the run's totals (per chosen project when filtered) -----------------
  const summaryRows = allocation
    ? meta.projects.map((chosen) => {
        const row = data.people.find((one) => one.project_id === chosen.id) ?? {}
        return {
          label: chosen.name,
          hours: row.project_total_hours ?? 0,
          late_hours: row.project_total_late_hours ?? 0,
          ...splitTotals(row, 'project_total'),
          gross: row.project_total_gross ?? 0,
          excluded_hours: row.project_excluded_hours ?? 0,
        }
      })
    : [
        {
          label: 'All projects',
          people: totals.total_people ?? 0,
          hours: totals.total_hours ?? 0,
          late_hours: totals.total_late_hours ?? 0,
          ...splitTotals(totals),
          gross: totals.total_gross ?? 0,
          excluded_hours: totals.excluded_hours ?? 0,
        },
      ]
  addTableSheet(workbook, {
    name: 'Summary',
    meta: sheetMeta,
    notes,
    columns: [
      { header: 'Project', key: 'label', type: 'text', width: 26 },
      ...(allocation ? [] : [{ header: 'People paid', key: 'people', type: 'whole', width: 11 }]),
      { header: 'Hours', key: 'hours', type: 'hours', width: 10 },
      { header: 'Late hours (earlier periods)', key: 'late_hours', type: 'hours', width: 13 },
      ...hoursSplitColumns(summaryRows),
      ...paySplitColumns(summaryRows),
      money,
      { header: 'Excluded hours (not approved yet)', key: 'excluded_hours', type: 'hours', width: 15 },
    ],
    rows: summaryRows,
    // Filtered: the projects' rows add up to the database's totals.
    totals: allocation
      ? {
          hours: totals.total_hours ?? 0,
          late_hours: totals.total_late_hours ?? 0,
          ...splitTotals(totals),
          gross: totals.total_gross ?? 0,
          excluded_hours: totals.excluded_hours ?? 0,
        }
      : undefined,
  })

  // --- Pay run: per person (per project when filtered) -------------------------
  addTableSheet(workbook, {
    name: allocation ? 'Labour allocation' : 'Pay run',
    meta: sheetMeta,
    notes,
    columns: [
      { header: 'Employee', key: 'employee_name', type: 'text', width: 24 },
      project,
      { header: 'Category', key: 'category_label', type: 'text', width: 16 },
      { header: 'Days', key: 'days', type: 'whole', width: 8 },
      { header: 'Hours', key: 'hours', type: 'hours', width: 10 },
      { header: 'Late hours (earlier periods)', key: 'late_hours', type: 'hours', width: 13 },
      ...hoursSplitColumns(included),
      ...rateColumns(included),
      ...paySplitColumns(included),
      money,
    ],
    rows: included.map((row) => ({ ...describe(row), ...rateValues(row) })),
    totals: {
      hours: totals.total_hours ?? 0,
      late_hours: totals.total_late_hours ?? 0,
      ...splitTotals(totals),
      gross: totals.total_gross ?? 0,
    },
    groups: projectGroups(meta.projects, (row) => ({
      hours: row.project_total_hours ?? 0,
      late_hours: row.project_total_late_hours ?? 0,
      ...splitTotals(row, 'project_total'),
      gross: row.project_total_gross ?? 0,
    })),
  })

  // --- Daily grid: the period's dates across; late days in their own column ------
  const dates = datesBetween(meta.from, meta.to)
  const rowKey = (row) => `${row.employee_id}|${row.project_id ?? ''}`
  const hoursOn = new Map(
    data.days.filter((day) => day.included && !day.late).map((day) => [`${rowKey(day)}|${day.day}`, day.hours]),
  )
  const { sheet: grid, written } = addTableSheet(workbook, {
    name: 'Daily grid',
    meta: sheetMeta,
    notes: [...notes, 'Hours paid in this run. Late hours: days from earlier periods, paid now.'],
    columns: [
      { header: 'Employee', key: 'employee_name', type: 'text', width: 24 },
      project,
      ...dates.map((date) => ({ header: date, dateHeader: true, key: date, type: 'hours', width: 8 })),
      { header: 'Late hours (earlier periods)', key: 'late_hours', type: 'hours', width: 13 },
      { header: 'Total hours', key: 'hours', type: 'hours', width: 11 },
    ],
    rows: included.map((row) => ({
      employee_name: row.employee_name,
      project_id: row.project_id,
      project_name: row.project_name,
      late_hours: row.late_hours,
      hours: row.hours,
      project_total_hours: row.project_total_hours,
      project_total_late_hours: row.project_total_late_hours,
      ...Object.fromEntries(dates.map((date) => [date, hoursOn.get(`${rowKey(row)}|${date}`) ?? null])),
    })),
    // Each date's column total is worked out by Excel when the file opens;
    // the hours totals are the database's.
    totals: {
      ...Object.fromEntries(dates.map((date) => [date, null])),
      late_hours: totals.total_late_hours ?? 0,
      hours: totals.total_hours ?? 0,
    },
    groups: projectGroups(meta.projects, (row) => ({
      late_hours: row.project_total_late_hours ?? 0,
      hours: row.project_total_hours ?? 0,
    })),
  })
  // Each row's total: a SUM across its days and late hours, carrying the
  // database's hours for that row.
  const firstDateColumn = grid.getColumn(3).letter
  const lateColumn = grid.getColumn(dates.length + 3).letter
  for (const { row, number } of written) {
    const cell = grid.getRow(number).getCell(dates.length + 4)
    cell.value = { formula: `SUM(${firstDateColumn}${number}:${lateColumn}${number})`, result: num(row.hours) }
    cell.numFmt = HOURS
  }

  // --- Excluded: pending people ------------------------------------------------
  addTableSheet(workbook, {
    name: 'Excluded',
    meta: { ...sheetMeta, report: `${name} — version ${run.version}: Excluded — pending/unapproved employees` },
    notes: [
      ...superseded,
      'Excluded — not approved yet (no rate). Not paid in this run: once approved, their hours are paid in a later run as late hours.',
      CONFIDENTIAL,
    ],
    columns: [
      { header: 'Employee', key: 'employee_name', type: 'text', width: 24 },
      project,
      { header: 'Category', key: 'category_label', type: 'text', width: 16 },
      { header: 'Days', key: 'days', type: 'whole', width: 8 },
      { header: 'Hours', key: 'hours', type: 'hours', width: 10 },
    ],
    rows: excluded.map(describe),
    totals: { hours: totals.excluded_hours ?? 0 },
    groups: projectGroups(meta.projects, (row) => ({ hours: row.project_excluded_hours ?? 0 })),
  })

  return {
    workbook,
    filename: exportFilename(
      `pay-run-v${run.version}${allocation ? '-labour-allocation' : ''}`,
      meta.projects,
      meta.from,
      meta.to,
    ),
  }
}
