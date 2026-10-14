import { formatDateTime } from '../labels.js'
import { CONFIDENTIAL, num } from './workbook.js'

// The look of the payroll and the expenses statement - a matched pair,
// copied from the owner's own payroll workbook (docs/payroll-export-format.md):
// Arial, navy and green title bars, columns C to M, no gridlines.
// Plain JavaScript (no app-only imports), so the attack test builds exactly
// the same files in Node.

export const COMPANY_TITLE = 'NKUTWALA CONSTRUCTION'
export const PREPARED_BY = 'Prepared by: Nkutwala Construction'

export const COLOURS = {
  navy: 'FF1A5276',
  green: 'FF1E8449',
  summary: 'FF154360',
  yellow: 'FFF9E79F',
  pale: 'FFEAF4FB',
  white: 'FFFFFFFF',
  note: 'FF555555',
  input: 'FF0000FF',
  red: 'FFC20116',
}

// Money as in the workbook: "R 4 562,50" accounting style; the RATE column
// its own plain rand format.
export const RAND = '_-[$R-431] * #,##0.00_-;-[$R-431] * #,##0.00_-;_-[$R-431] * -??_-;_-@_-'
export const RATE = '[$R-431] #,##0.00;[Red]-[$R-431] #,##0.00'
export const DATE = 'dd mmm yyyy'

const LINE = { style: 'thin', color: { argb: 'FFAAAAAA' } }
export const BOX = { left: LINE, right: LINE, top: LINE, bottom: LINE }

export const font = (extra = {}) => ({ name: 'Arial', size: 10, ...extra })
export const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } })
export const CENTRE = { horizontal: 'center', vertical: 'middle' }

// An Excel formula that also carries the database's figure, so the file is
// right even before Excel works it out again.
export const formula = (text, result) => ({ formula: text, result: num(result) ?? 0 })

const MONTHS = [
  'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
  'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
]
// The workbook's short forms (AUG, SEPT).
const SHORT = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUNE', 'JULY', 'AUG', 'SEPT', 'OCT', 'NOV', 'DEC']

const partsOf = (isoDate) => isoDate.slice(0, 10).split('-').map(Number)

// "2026-09-01" -> "SEPTEMBER 2026"
export function monthLabel(isoDate) {
  const [year, month] = partsOf(isoDate)
  return `${MONTHS[month - 1]} ${year}`
}

// A date range as the workbook writes it: "28 AUG – 10 SEPT 2026",
// "11 – 22 SEPT 2026"; capitals: false -> "28 Aug – 10 Sept 2026".
export function rangeLabel(from, to, { capitals = true } = {}) {
  const [y1, m1, d1] = partsOf(from)
  const [y2, m2, d2] = partsOf(to)
  const month = (m) => (capitals ? SHORT[m - 1] : SHORT[m - 1][0] + SHORT[m - 1].slice(1).toLowerCase())
  if (from === to) return `${d1} ${month(m1)} ${y1}`
  if (y1 === y2 && m1 === m2) return `${d1} – ${d2} ${month(m2)} ${y2}`
  if (y1 === y2) return `${d1} ${month(m1)} – ${d2} ${month(m2)} ${y2}`
  return `${d1} ${month(m1)} ${y1} – ${d2} ${month(m2)} ${y2}`
}

// A new sheet: no gridlines, column A narrow, then the widths of C, D, ...
export function addHouseSheet(workbook, name, widths) {
  const sheet = workbook.addWorksheet(name, { views: [{ showGridLines: false }] })
  sheet.getColumn(1).width = 3
  widths.forEach((width, index) => {
    sheet.getColumn(index + 3).width = width
  })
  return sheet
}

// A bar across columns from..to (merged): a title, a table's heading.
export function bar(sheet, row, text, { argb, size = 11, height, from = 'C', to = 'M' }) {
  sheet.mergeCells(`${from}${row}:${to}${row}`)
  const cell = sheet.getCell(`${from}${row}`)
  cell.value = text
  cell.font = font({ bold: true, size, color: { argb: COLOURS.white } })
  cell.fill = fill(argb)
  cell.alignment = CENTRE
  if (height) sheet.getRow(row).height = height
  return cell
}

// Above the layout (rows 2-3): confidential, and who made the file and when.
// Rows 5-6: the company title bar and the project | period bar.
//   meta: { generatedBy, generatedAt }; extra: added to row 3
export function addTitleBlock(sheet, { title, subtitle, meta, extra = '' }) {
  const popia = sheet.getCell('C2')
  popia.value = CONFIDENTIAL
  popia.font = font({ bold: true, size: 9, color: { argb: COLOURS.red } })
  const made = sheet.getCell('C3')
  made.value = `Generated ${formatDateTime(meta.generatedAt)} by ${meta.generatedBy}.${extra ? ` ${extra}` : ''}`
  made.font = font({ italic: true, size: 8, color: { argb: COLOURS.note } })

  bar(sheet, 5, `${COMPANY_TITLE} — ${title}`, { argb: COLOURS.navy, size: 14, height: 27.75 })
  bar(sheet, 6, subtitle, { argb: COLOURS.green, size: 10, height: 18 })
}

// "Prepared by: Nkutwala Construction  |  <PROJECT>"
export function addPreparedBy(sheet, row, projectName) {
  const cell = sheet.getCell(`C${row}`)
  cell.value = `${PREPARED_BY}  |  ${projectName.toUpperCase()}`
  cell.font = font({ bold: true, size: 9, color: { argb: COLOURS.navy } })
}

// A summary line: the label merged across from..to, the figure in the next
// column (bold, boxed, yellow unless plain).
export function summaryLine(sheet, row, { label, value, bold = false, plain = false, from = 'C', to = 'E', figure = 'F' }) {
  sheet.mergeCells(`${from}${row}:${to}${row}`)
  const labelCell = sheet.getCell(`${from}${row}`)
  labelCell.value = label
  labelCell.font = font({ bold })
  const cell = sheet.getCell(`${figure}${row}`)
  cell.value = value
  cell.numFmt = RAND
  cell.font = font({ bold: true })
  cell.border = BOX
  if (!plain) cell.fill = fill(COLOURS.yellow)
  return cell
}
