import { COST_CATEGORY_LABELS, EMPLOYEE_CATEGORY_LABELS, EMPLOYEE_STATUS_LABELS } from '../labels.js'
import {
  CONFIDENTIAL,
  PROVISIONAL_NOTE,
  VAT_NOTE,
  addTableSheet,
  call,
  createWorkbook,
  exportFilename,
} from './workbook.js'

// Export 1: the project cost report (owners/admins only - the database
// returns nothing to anyone else). Four sheets: Summary, Labour, Receipts,
// By week. Every figure and total comes from the database.

export const PROJECT_COST = { type: 'project_cost', slug: 'project-cost', name: 'Project cost report' }

//   projectId: a project, or null for all projects; from/to: "YYYY-MM-DD"
export async function fetchProjectCost(client, { projectId, from, to }) {
  const args = { p_project_id: projectId, p_from: from, p_to: to }
  const [summary, labour, receipts, weeks] = await Promise.all([
    call(client, 'export_cost_summary', args),
    call(client, 'export_labour', args),
    call(client, 'drill_receipts', { ...args, p_category: null, p_vendor: null }),
    call(client, 'dashboard_weekly_mix', args),
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

export function rateValues(person) {
  return Object.fromEntries(
    person.rates.flatMap((rate, index) => [
      [`rate${index + 1}`, rate.rate],
      [`from${index + 1}`, rate.from],
    ]),
  )
}

//   meta: { company, projectName, from, to, generatedBy, generatedAt }
export function buildProjectCost(data, meta) {
  const workbook = createWorkbook()
  const sheetMeta = { ...meta, report: PROJECT_COST.name }
  const first = (rows) => rows[0] ?? {}

  // --- Summary ------------------------------------------------------------------
  const summaryTotals = first(data.summary)
  addTableSheet(workbook, {
    name: 'Summary',
    meta: sheetMeta,
    notes: [CONFIDENTIAL, VAT_NOTE, PROVISIONAL_NOTE],
    columns: [
      { header: 'Category', key: 'label', type: 'text', width: 18 },
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
  })

  // --- Labour -------------------------------------------------------------------
  const labourTotals = first(data.labour)
  addTableSheet(workbook, {
    name: 'Labour',
    meta: sheetMeta,
    notes: [CONFIDENTIAL, PROVISIONAL_NOTE],
    columns: [
      { header: 'Employee', key: 'full_name', type: 'text', width: 24 },
      { header: 'Category', key: 'category_label', type: 'text', width: 16 },
      { header: 'Status', key: 'status_label', type: 'text', width: 11 },
      { header: 'Days worked', key: 'days', type: 'whole', width: 11 },
      { header: 'Hours', key: 'hours', type: 'hours', width: 10 },
      { header: 'Unpriced hours', key: 'unpriced_hours', type: 'hours', width: 11 },
      ...rateColumns(data.labour),
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
      unpriced_hours: labourTotals.total_unpriced_hours ?? 0,
      cost: labourTotals.total_cost ?? 0,
    },
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
      { header: 'Project', key: 'project_name', type: 'text', width: 24 },
      { header: 'Uploaded by', key: 'uploader_name', type: 'text', width: 20 },
      { header: 'Total paid (VAT inclusive)', key: 'amount', type: 'money', width: 18 },
      { header: 'Notes', key: 'notes', type: 'text', width: 30 },
    ],
    rows: data.receipts,
    totals: { amount: receiptTotals.total_amount ?? 0 },
  })

  // --- By week ------------------------------------------------------------------
  // The weeks' totals are the database's own figures for the same period:
  // labour and owned plant from the Summary, receipts from the Receipts sheet.
  const spentOn = (category) => data.summary.find((row) => row.category === category)?.spent_in_period ?? 0
  addTableSheet(workbook, {
    name: 'By week',
    meta: sheetMeta,
    notes: [CONFIDENTIAL, VAT_NOTE],
    columns: [
      { header: 'Week starting (Monday)', key: 'week_start', type: 'date', width: 16 },
      { header: 'Labour', key: 'labour', type: 'money', width: 15 },
      { header: 'Owned plant', key: 'owned_plant', type: 'money', width: 15 },
      { header: 'Receipts (VAT inclusive)', key: 'receipts', type: 'money', width: 18 },
      { header: 'Total', key: 'total', type: 'money', width: 15 },
    ],
    rows: data.weeks,
    totals: {
      labour: spentOn('labour'),
      owned_plant: spentOn('owned_plant'),
      receipts: receiptTotals.total_amount ?? 0,
      total: summaryTotals.total_spent_in_period ?? 0,
    },
  })

  return {
    workbook,
    filename: exportFilename(PROJECT_COST.slug, meta.projectName, meta.from, meta.to),
  }
}
