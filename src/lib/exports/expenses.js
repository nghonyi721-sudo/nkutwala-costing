import { call, callAll, createWorkbook, excelDate, exportFilename, num } from './workbook.js'
import {
  BOX,
  COLOURS,
  DATE,
  RAND,
  addHouseSheet,
  addPreparedBy,
  addTitleBlock,
  bar,
  fill,
  font,
  formula,
  rangeLabel,
  summaryLine,
} from './houseStyle.js'

// The expenses statement (owners/admins only - the database refuses anyone
// else): the project's APPROVED receipts in the dates, oldest first, then by
// category, reimbursements owed and the grand total. Same house style as the
// payroll (docs/payroll-export-format.md). Every figure comes from the
// database (expense_lines, expense_totals); totals are formulas carrying
// the database's figures. Amounts: the total paid, VAT inclusive.

export const EXPENSES = { type: 'expenses_statement', slug: 'expenses', name: 'Expenses statement' }

// The table's columns from C.
const COLUMNS = [
  { header: 'DATE', key: 'receipt_date', letter: 'C' },
  { header: 'VENDOR', key: 'vendor', letter: 'D' },
  { header: 'CATEGORY', key: 'category_label', letter: 'E' },
  { header: 'DESCRIPTION', key: 'description', letter: 'F' },
  { header: 'PAID BY', key: 'paid_by', letter: 'G' },
  { header: 'AMOUNT', key: 'amount', letter: 'H' },
]

// C to H for the table; I to M narrow (the title bars still span C:M).
const WIDTHS = [13, 26, 14, 34, 22, 16, 6, 6, 6, 6, 6]

//   project: { id, name }; from/to: "YYYY-MM-DD"
export async function fetchExpenses(client, { project, from, to }) {
  const args = { p_project_id: project.id, p_from: from, p_to: to }
  const [lines, totals] = await Promise.all([callAll(client, 'expense_lines', args), call(client, 'expense_totals', args)])
  return { lines, totals }
}

// A summary line: label merged C:G, the figure in H (under AMOUNT).
const line = (sheet, row, options) => summaryLine(sheet, row, { from: 'C', to: 'G', figure: 'H', ...options })

//   meta: { project: { id, name }, from, to, generatedBy, generatedAt }
export function buildExpenses(data, meta) {
  const workbook = createWorkbook()
  const projectName = meta.project.name
  const sheet = addHouseSheet(workbook, 'EXPENSES STATEMENT', WIDTHS)
  addTitleBlock(sheet, {
    title: 'EXPENSES STATEMENT',
    subtitle: `${projectName.toUpperCase()}  |  ${rangeLabel(meta.from, meta.to)}`,
    meta,
    extra: 'Approved expenses only. Amounts are the total paid, VAT inclusive.',
  })

  // --- The table --------------------------------------------------------------
  const headerRow = 8
  for (const column of COLUMNS) {
    const cell = sheet.getCell(`${column.letter}${headerRow}`)
    cell.value = column.header
    cell.font = font({ bold: true, size: 9, color: { argb: COLOURS.white } })
    cell.fill = fill(COLOURS.navy)
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    cell.border = BOX
  }
  sheet.getRow(headerRow).height = 24

  let row = headerRow + 1
  const firstRow = row
  for (const expense of data.lines) {
    for (const column of COLUMNS) {
      const cell = sheet.getCell(`${column.letter}${row}`)
      if (column.key === 'receipt_date') {
        cell.value = excelDate(expense.receipt_date)
        cell.numFmt = DATE
      } else if (column.key === 'amount') {
        cell.value = num(expense.amount)
        cell.numFmt = RAND
      } else {
        cell.value = expense[column.key] ?? null
      }
      cell.font = font()
      cell.fill = fill(COLOURS.pale)
      cell.border = BOX
      cell.alignment = { vertical: 'middle', wrapText: column.key === 'description' }
    }
    row += 1
  }
  if (data.lines.length === 0) {
    const cell = sheet.getCell(`C${row}`)
    cell.value = 'No approved expenses in these dates'
    cell.font = font({ italic: true, color: { argb: COLOURS.note } })
    row += 1
  }
  const lastRow = row - 1
  const amounts = `H${firstRow}:H${lastRow}`
  const total = (section) => data.totals.find((item) => item.section === section)

  // TOTALS (merged C:G), the amount sum in H.
  const totalsRow = row
  sheet.mergeCells(`C${totalsRow}:G${totalsRow}`)
  sheet.getCell(`C${totalsRow}`).value = 'TOTALS'
  for (const letter of ['C', 'H']) {
    const cell = sheet.getCell(`${letter}${totalsRow}`)
    cell.font = font({ bold: true, color: { argb: COLOURS.white } })
    cell.fill = fill(COLOURS.navy)
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    cell.border = BOX
  }
  const totalsCell = sheet.getCell(`H${totalsRow}`)
  totalsCell.value = formula(`SUM(${amounts})`, total('grand_total')?.amount)
  totalsCell.numFmt = RAND
  sheet.getRow(totalsRow).height = 18.75
  row = totalsRow + 2

  // --- By category ------------------------------------------------------------
  bar(sheet, row, 'BY CATEGORY', { argb: COLOURS.summary, height: 19.5 })
  row += 1
  for (const category of data.totals.filter((item) => item.section === 'category')) {
    line(sheet, row, {
      label: category.label,
      value: formula(`SUMIF(E${firstRow}:E${lastRow},"${category.label}",${amounts})`, category.amount),
    })
    row += 1
  }
  row += 1

  // --- Reimbursements owed ----------------------------------------------------
  // Money paid out of pocket, owed back separately from wages. None yet:
  // receipts don't record who paid, so PAID BY is always Company.
  bar(sheet, row, 'REIMBURSEMENTS OWED', { argb: COLOURS.summary, height: 19.5 })
  row += 1
  const owed = data.totals.filter((item) => item.section === 'reimbursement')
  for (const person of owed) {
    line(sheet, row, { label: person.label, value: formula(`SUMIF(G${firstRow}:G${lastRow},"${person.label}",${amounts})`, person.amount) })
    row += 1
  }
  if (owed.length === 0) {
    sheet.mergeCells(`C${row}:G${row}`)
    sheet.getCell(`C${row}`).value = 'None — all expenses paid by the company'
    sheet.getCell(`C${row}`).font = font({ italic: true, color: { argb: COLOURS.note } })
    row += 1
  }
  line(sheet, row, {
    label: 'Total owed',
    bold: true,
    value: formula(`SUMIF(G${firstRow}:G${lastRow},"Owed to*",${amounts})`, total('reimbursements_total')?.amount),
  })
  row += 2

  // --- Grand total ------------------------------------------------------------
  line(sheet, row, {
    label: 'GRAND TOTAL',
    bold: true,
    value: formula(`H${totalsRow}`, total('grand_total')?.amount),
  })
  row += 2

  addPreparedBy(sheet, row, projectName)

  return {
    workbook,
    filename: exportFilename(EXPENSES.slug, [meta.project], meta.from, meta.to),
  }
}
