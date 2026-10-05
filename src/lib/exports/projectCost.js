import { COST_CATEGORY_LABELS, EMPLOYEE_CATEGORY_LABELS, EMPLOYEE_STATUS_LABELS } from '../labels.js'
import {
  CONFIDENTIAL,
  PROVISIONAL_NOTE,
  VAT_NOTE,
  addTableSheet,
  call,
  createWorkbook,
  exportFilename,
  isGrouped,
  projectGroups,
} from './workbook.js'

// Export 1: the project cost report (owners/admins only - the database
// returns nothing to anyone else). Four sheets: Summary, Labour, Receipts,
// By week. Every figure, subtotal and total comes from the database.
// With two or more projects chosen, every sheet goes project by project,
// each with its subtotal, then the grand total.

export const PROJECT_COST = { type: 'project_cost', slug: 'project-cost', name: 'Project cost report' }

// The database's project list: null = all projects.
export const projectIdsOf = (projects) => (projects?.length ? projects.map((project) => project.id) : null)

//   projects: null (all projects) or [{ id, name }]; from/to: "YYYY-MM-DD"
export async function fetchProjectCost(client, { projects, from, to }) {
  const args = { p_project_ids: projectIdsOf(projects), p_from: from, p_to: to }
  const [summary, labour, receipts, weeks] = await Promise.all([
    call(client, 'export_cost_summary', args),
    call(client, 'export_labour', args),
    call(client, 'export_receipts', args),
    call(client, 'export_weekly', args),
  ])
  return { summary, labour, receipts, weeks }
}

// The rates a person was paid at, as columns: Rate 1, From 1, Rate 2, ...
// (real numbers and real dates, never text).
export function rateColumns(people) {
  const most = Math.max(0, ...people.map((person) => person.rates.length))
  const columns = []
  for (let n = 1; n <= most; n += 1) {
    const suffix = most === 1 ? '' : ` ${n}`
    columns.push({ header: `Rate${suffix} (R/h)`, key: `rate${n}`, type: 'money', width: 13 })
    columns.push({ header: `Rate${suffix} from`, key: `from${n}`, type: 'date', width: 13 })
  }
  return columns
}

// Hours split by the pay rules: ordinary, overtime and (only when someone
// has any) Sunday / public holiday hours. Real numbers, from the database.
const hasPremium = (people) => people.some((person) => Number(person.premium_hours) > 0)

export function hoursSplitColumns(people) {
  return [
    { header: 'Ordinary hours', key: 'ordinary_hours', type: 'hours', width: 11 },
    { header: 'Overtime hours', key: 'ot_hours', type: 'hours', width: 11 },
    ...(hasPremium(people) ? [{ header: 'Sunday / holiday hours', key: 'premium_hours', type: 'hours', width: 12 }] : []),
  ]
}

export function paySplitColumns(people) {
  return [
    { header: 'Ordinary pay', key: 'ordinary_pay', type: 'money', width: 15 },
    { header: 'Overtime pay', key: 'ot_pay', type: 'money', width: 15 },
    ...(hasPremium(people) ? [{ header: 'Sunday / holiday pay', key: 'premium_pay', type: 'money', width: 15 }] : []),
  ]
}

// The database's totals for those columns (its rows all carry them).
//   prefix: 'total' (the grand totals) or 'project_total' (a project's subtotals)
export function splitTotals(totals, prefix = 'total') {
  return {
    ordinary_hours: totals[`${prefix}_ordinary_hours`] ?? 0,
    ot_hours: totals[`${prefix}_ot_hours`] ?? 0,
    premium_hours: totals[`${prefix}_premium_hours`] ?? 0,
    ordinary_pay: totals[`${prefix}_ordinary_pay`] ?? 0,
    ot_pay: totals[`${prefix}_ot_pay`] ?? 0,
    premium_pay: totals[`${prefix}_premium_pay`] ?? 0,
  }
}

// The Project column of a line-item sheet: the row's project, or (all
// projects, one row per person) the projects they worked on.
export const projectColumn = (header = 'Project') => ({ header, key: 'project_name', type: 'text', width: 24 })

export function rateValues(person) {
  return Object.fromEntries(
    person.rates.flatMap((rate, index) => [
      [`rate${index + 1}`, rate.rate],
      [`from${index + 1}`, rate.from],
    ]),
  )
}

//   meta: { company, projects, from, to, generatedBy, generatedAt }
//         projects: null (all projects) or [{ id, name }]
export function buildProjectCost(data, meta) {
  const workbook = createWorkbook()
  const sheetMeta = { ...meta, report: PROJECT_COST.name }
  const first = (rows) => rows[0] ?? {}
  // Summary and By week are per project only with two or more projects;
  // the line-item sheets (Labour, Receipts) always have a Project column.
  const perProject = isGrouped(meta.projects) ? [projectColumn()] : []

  // --- Summary ------------------------------------------------------------------
  const summaryTotals = first(data.summary)
  addTableSheet(workbook, {
    name: 'Summary',
    meta: sheetMeta,
    notes: [CONFIDENTIAL, VAT_NOTE, PROVISIONAL_NOTE],
    columns: [
      { header: 'Category', key: 'label', type: 'text', width: 18 },
      ...perProject,
      { header: 'Budget', key: 'budget', type: 'money', width: 16 },
      { header: 'Spent in period', key: 'spent_in_period', type: 'money', width: 17 },
      { header: 'Spent to date', key: 'spent_to_date', type: 'money', width: 16 },
      { header: '% of budget used (to date)', key: 'percent_used', type: 'percent', width: 15 },
      { header: 'Unpriced hours in period', key: 'unpriced_hours', type: 'hours', width: 15 },
    ],
    rows: data.summary.map((row) => ({ ...row, label: row.label ?? COST_CATEGORY_LABELS[row.category] })),
    totals: {
      budget: summaryTotals.total_budget ?? null,
      spent_in_period: summaryTotals.total_spent_in_period ?? 0,
      spent_to_date: summaryTotals.total_spent_to_date ?? 0,
      unpriced_hours: summaryTotals.total_unpriced_hours ?? 0,
    },
    groups: projectGroups(meta.projects, (row) => ({
      budget: row.project_total_budget ?? null,
      spent_in_period: row.project_total_spent_in_period ?? 0,
      spent_to_date: row.project_total_spent_to_date ?? 0,
      unpriced_hours: row.project_total_unpriced_hours ?? 0,
    })),
  })

  // --- Labour -------------------------------------------------------------------
  const labourTotals = first(data.labour)
  addTableSheet(workbook, {
    name: 'Labour',
    meta: sheetMeta,
    notes: [CONFIDENTIAL, PROVISIONAL_NOTE],
    columns: [
      { header: 'Employee', key: 'full_name', type: 'text', width: 24 },
      projectColumn(meta.projects?.length ? 'Project' : 'Projects worked'),
      { header: 'Category', key: 'category_label', type: 'text', width: 16 },
      { header: 'Status', key: 'status_label', type: 'text', width: 11 },
      { header: 'Days worked', key: 'days', type: 'whole', width: 11 },
      { header: 'Hours', key: 'hours', type: 'hours', width: 10 },
      ...hoursSplitColumns(data.labour),
      { header: 'Unpriced hours', key: 'unpriced_hours', type: 'hours', width: 11 },
      ...rateColumns(data.labour),
      ...paySplitColumns(data.labour),
      { header: 'Cost (provisional)', key: 'cost', type: 'money', width: 17 },
    ],
    rows: data.labour.map((person) => ({
      ...person,
      ...rateValues(person),
      category_label: EMPLOYEE_CATEGORY_LABELS[person.category] ?? person.category,
      status_label: EMPLOYEE_STATUS_LABELS[person.status] ?? person.status,
    })),
    totals: {
      hours: labourTotals.total_hours ?? 0,
      ...splitTotals(labourTotals),
      unpriced_hours: labourTotals.total_unpriced_hours ?? 0,
      cost: labourTotals.total_cost ?? 0,
    },
    groups: projectGroups(meta.projects, (row) => ({
      hours: row.project_total_hours ?? 0,
      ...splitTotals(row, 'project_total'),
      unpriced_hours: row.project_total_unpriced_hours ?? 0,
      cost: row.project_total_cost ?? 0,
    })),
  })

  // --- Receipts (approved only) ---------------------------------------------------
  const receiptTotals = first(data.receipts)
  addTableSheet(workbook, {
    name: 'Receipts',
    meta: sheetMeta,
    notes: [CONFIDENTIAL, 'Approved receipts only. Amounts are VAT inclusive.'],
    columns: [
      { header: 'Date', key: 'receipt_date', type: 'date', width: 13 },
      { header: 'Vendor', key: 'vendor', type: 'text', width: 26 },
      { header: 'Category', key: 'category_label', type: 'text', width: 14 },
      projectColumn(),
      { header: 'Uploaded by', key: 'uploader_name', type: 'text', width: 20 },
      { header: 'Total paid (VAT inclusive)', key: 'amount', type: 'money', width: 18 },
      { header: 'Notes', key: 'notes', type: 'text', width: 30 },
    ],
    rows: data.receipts,
    totals: { amount: receiptTotals.total_amount ?? 0 },
    groups: projectGroups(meta.projects, (row) => ({ amount: row.project_total_amount ?? 0 })),
  })

  // --- By week ------------------------------------------------------------------
  // The dashboard's weekly figures; their totals equal the Summary's.
  const weekTotals = first(data.weeks)
  addTableSheet(workbook, {
    name: 'By week',
    meta: sheetMeta,
    notes: [CONFIDENTIAL, VAT_NOTE],
    columns: [
      { header: 'Week starting (Monday)', key: 'week_start', type: 'date', width: 16 },
      ...perProject,
      { header: 'Labour', key: 'labour', type: 'money', width: 15 },
      { header: 'Owned plant', key: 'owned_plant', type: 'money', width: 15 },
      { header: 'Receipts (VAT inclusive)', key: 'receipts', type: 'money', width: 18 },
      { header: 'Total', key: 'total', type: 'money', width: 15 },
    ],
    rows: data.weeks,
    totals: {
      labour: weekTotals.total_labour ?? 0,
      owned_plant: weekTotals.total_owned_plant ?? 0,
      receipts: weekTotals.total_receipts ?? 0,
      total: weekTotals.total_all ?? 0,
    },
    groups: projectGroups(meta.projects, (row) => ({
      labour: row.project_total_labour ?? 0,
      owned_plant: row.project_total_owned_plant ?? 0,
      receipts: row.project_total_receipts ?? 0,
      total: row.project_total_all ?? 0,
    })),
  })

  return {
    workbook,
    filename: exportFilename(PROJECT_COST.slug, meta.projects, meta.from, meta.to),
  }
}
