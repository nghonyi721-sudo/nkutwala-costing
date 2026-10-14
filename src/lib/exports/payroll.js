import { callAll, createWorkbook, exportFilename, num } from './workbook.js'
import {
  BOX,
  CENTRE,
  COLOURS,
  RAND,
  RATE,
  addHouseSheet,
  addPreparedBy,
  addTitleBlock,
  bar,
  fill,
  font,
  formula,
  monthLabel,
  rangeLabel,
  summaryLine,
} from './houseStyle.js'

// The payroll file (owners/admins only - the database refuses anyone else),
// exactly as docs/payroll-export-format.md: one sheet per month, a table per
// 14-day block (FIRST FORTNIGHT, SECOND FORTNIGHT...), then the month
// summary and the SARS UIF declaration.
//
// Every figure comes from the database (payroll_lines, payroll_blocks):
// rows are plain numbers (Excel's own rounding would turn 215.625 into
// 215.63 - the database rounds half to even, as the workbook does); TOTALS
// and summary lines are formulas carrying the database's figures.

export const PAYROLL = { type: 'payroll', slug: 'payroll', name: 'Payroll' }

// The table's columns, C to M, exactly as the spec writes them. OVER TIME
// (G) is hours; OVERTIME (J) is money.
const COLUMNS = [
  { header: 'NAME', key: 'first_names', letter: 'C' },
  { header: 'SURNAME', key: 'surname', letter: 'D' },
  { header: 'RATE', key: 'rate', letter: 'E', format: RATE },
  { header: 'NORMAL HOURS', key: 'normal_hours', letter: 'F', total: true },
  { header: 'OVER TIME', key: 'ot_hours', letter: 'G', total: true },
  { header: 'TOTAL HOURS', key: 'total_hours', letter: 'H', total: true },
  { header: 'GROSS SALARY', key: 'gross', letter: 'I', format: RAND, total: true },
  { header: 'OVERTIME', key: 'overtime', letter: 'J', format: RAND, total: true },
  { header: 'TOTAL SALARY', key: 'total_salary', letter: 'K', format: RAND, total: true, highlight: true },
  { header: 'UIF', key: 'uif', letter: 'L', format: RAND, total: true },
  { header: 'NET SALARY', key: 'net', letter: 'M', format: RAND, total: true },
]

// The workbook's column widths, C to M.
const WIDTHS = [16, 16, 11, 20, 10, 11, 15, 13, 15, 11, 15]

const ORDINALS = ['FIRST', 'SECOND', 'THIRD', 'FOURTH', 'FIFTH']

//   project: { id, name }; from/to: "YYYY-MM-DD"
export async function fetchPayroll(client, { project, from, to }) {
  const args = { p_project_id: project.id, p_from: from, p_to: to }
  const [blocks, lines] = await Promise.all([callAll(client, 'payroll_blocks', args), callAll(client, 'payroll_lines', args)])
  return { blocks, lines }
}

// The rate assumptions block (C8:D11) and its two notes (F9, F10).
function addRateAssumptions(sheet) {
  sheet.mergeCells('C8:D8')
  const heading = sheet.getCell('C8')
  heading.value = 'RATE ASSUMPTIONS'
  heading.font = font({ bold: true, size: 9, color: { argb: COLOURS.navy } })
  heading.fill = fill(COLOURS.yellow)

  const rows = [
    [9, 'Daily Rate (8 hrs)', 300, null],
    [10, 'Overtime / PH (x)', 1.5, null],
    // A plain number, not a percentage (the spec).
    [11, 'UIF rate', 0.01, '0.00'],
  ]
  for (const [row, label, value, format] of rows) {
    sheet.getCell(`C${row}`).value = label
    sheet.getCell(`C${row}`).font = font({ size: 9 })
    const cell = sheet.getCell(`D${row}`)
    cell.value = value
    cell.font = font({ bold: true, size: 9, color: { argb: COLOURS.input } })
    if (format) cell.numFmt = format
  }

  const notes = [
    ['F9', 'View: TOTAL HOURS / GROSS / OVERTIME / TOTAL SALARY / UIF / NET SALARY.'],
    ['F10', 'UIF allocated only to UIF-registered individuals.'],
  ]
  for (const [address, text] of notes) {
    sheet.getCell(address).value = text
    sheet.getCell(address).font = font({ italic: true, size: 8, color: { argb: COLOURS.note } })
  }
}

// One fortnight's table from row `start`: heading, headers, a row per
// person (per rate), TOTALS, Source. Returns { totalsRow, next } - next is
// the first free row after it.
function addBlockTable(sheet, start, block, lines) {
  const ordinal = ORDINALS[block.block_in_sheet - 1] ?? `${block.block_in_sheet}TH`
  bar(sheet, start, `${ordinal} FORTNIGHT — ${rangeLabel(block.block_start, block.block_end)}`, {
    argb: COLOURS.green,
    height: 19.5,
  })

  const headerRow = start + 1
  for (const column of COLUMNS) {
    const cell = sheet.getCell(`${column.letter}${headerRow}`)
    cell.value = column.header
    cell.font = font({ bold: true, size: 9, color: { argb: COLOURS.white } })
    cell.fill = fill(COLOURS.navy)
    cell.alignment = { ...CENTRE, wrapText: true }
    cell.border = BOX
  }
  sheet.getRow(headerRow).height = 30

  let row = headerRow + 1
  const firstRow = row
  for (const line of lines) {
    for (const column of COLUMNS) {
      const cell = sheet.getCell(`${column.letter}${row}`)
      const raw = line[column.key]
      if (column.key === 'first_names' || column.key === 'surname') {
        cell.value = raw ? String(raw).toUpperCase() : null
        cell.font = font({ bold: column.key === 'first_names' })
      } else {
        // UIF left blank (not 0) for people who aren't UIF registered.
        cell.value = num(raw)
        cell.font = font({ bold: Boolean(column.highlight) })
        cell.alignment = CENTRE
      }
      if (column.format) cell.numFmt = column.format
      cell.fill = fill(column.highlight ? COLOURS.yellow : COLOURS.pale)
      cell.border = BOX
    }
    sheet.getRow(row).height = 18
    row += 1
  }
  if (lines.length === 0) {
    const cell = sheet.getCell(`C${row}`)
    cell.value = 'No hours recorded'
    cell.font = font({ italic: true, color: { argb: COLOURS.note } })
    row += 1
  }
  const lastRow = row - 1

  // TOTALS (merged C:E), sums in F to M carrying the database's totals.
  const totalsRow = row
  sheet.mergeCells(`C${totalsRow}:E${totalsRow}`)
  const label = sheet.getCell(`C${totalsRow}`)
  label.value = 'TOTALS'
  for (const column of COLUMNS) {
    const cell = sheet.getCell(`${column.letter}${totalsRow}`)
    if (column.total) {
      cell.value = formula(`SUM(${column.letter}${firstRow}:${column.letter}${lastRow})`, block[column.key])
      if (column.format) cell.numFmt = column.format
    }
    cell.font = font({ bold: true, color: { argb: COLOURS.white } })
    cell.fill = fill(COLOURS.navy)
    cell.alignment = CENTRE
    cell.border = BOX
  }
  sheet.getRow(totalsRow).height = 18.75

  const source = sheet.getCell(`C${totalsRow + 1}`)
  const reports = Number(block.reports)
  source.value =
    `Source: submitted daily reports in Nkutwala Site Reports, ` +
    `${rangeLabel(block.block_start, block.block_end, { capitals: false })} (${reports} report${reports === 1 ? '' : 's'}).`
  source.font = font({ italic: true, size: 8, color: { argb: COLOURS.note } })
  sheet.getRow(totalsRow + 1).height = 15

  return { totalsRow, next: totalsRow + 3 }
}

// The month summary and the SARS declaration, from row `start`.
function addSummary(sheet, start, blocks, totalsRows, projectName) {
  const month = blocks[0]
  bar(sheet, start, `${monthLabel(month.sheet_month)} — MONTH SUMMARY`, { argb: COLOURS.summary, height: 19.5 })

  let row = start + 1
  const salaryRows = []
  blocks.forEach((block, index) => {
    const ordinal = (ORDINALS[block.block_in_sheet - 1] ?? `${block.block_in_sheet}th`).toLowerCase()
    summaryLine(sheet, row, {
      label: `Total salary — ${ordinal} fortnight`,
      value: formula(`K${totalsRows[index]}`, block.total_salary),
    })
    salaryRows.push(row)
    row += 1
  })
  summaryLine(sheet, row, {
    label: 'TOTAL SALARY — MONTH',
    bold: true,
    value: formula(salaryRows.map((r) => `F${r}`).join('+'), month.month_total_salary),
  })
  row += 1
  summaryLine(sheet, row, {
    label: 'NET PAY — MONTH',
    bold: true,
    value: formula(totalsRows.map((r) => `M${r}`).join('+'), month.month_net),
  })
  row += 2

  bar(sheet, row, 'SARS DECLARATION', { argb: COLOURS.navy })
  row += 1
  // Employee UIF x 2: the employer matches it 1:1.
  const uifRow = row
  summaryLine(sheet, row, {
    label: 'UIF (employee + employer)',
    plain: true,
    value: formula(`(${totalsRows.map((r) => `L${r}`).join('+')})*2`, month.month_uif_declaration),
  })
  row += 1
  summaryLine(sheet, row, {
    label: 'TOTALS',
    bold: true,
    value: formula(`F${uifRow}`, month.month_uif_declaration),
  })
  row += 2

  addPreparedBy(sheet, row, projectName)
}

//   meta: { project: { id, name }, from, to, generatedBy, generatedAt }
export function buildPayroll(data, meta) {
  const workbook = createWorkbook()
  const projectName = meta.project.name

  // The blocks on each month's sheet, in order.
  const sheets = new Map()
  for (const block of data.blocks) {
    const month = String(block.sheet_month).slice(0, 10)
    if (!sheets.has(month)) sheets.set(month, [])
    sheets.get(month).push(block)
  }

  for (const [month, blocks] of sheets) {
    const sheet = addHouseSheet(workbook, monthLabel(month), WIDTHS)
    addTitleBlock(sheet, {
      title: 'PAYROLL',
      subtitle: `${projectName.toUpperCase()}  |  ${monthLabel(month)}`,
      meta,
    })
    addRateAssumptions(sheet)

    let row = 13
    const totalsRows = []
    for (const block of blocks) {
      const lines = data.lines.filter((line) => line.block_no === block.block_no)
      const placed = addBlockTable(sheet, row, block, lines)
      totalsRows.push(placed.totalsRow)
      row = placed.next
    }
    addSummary(sheet, row, blocks, totalsRows, projectName)
  }

  return {
    workbook,
    filename: exportFilename(PAYROLL.slug, [meta.project], meta.from, meta.to),
  }
}
