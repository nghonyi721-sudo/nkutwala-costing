import ExcelJS from 'exceljs'
import { formatDate } from '../labels.js'

// The rules every Excel export follows. Plain JavaScript (no app-only
// imports), so the attack test (scripts/rls-attack-test.mjs) builds exactly
// the same files in Node.
//
// RULE: no arithmetic on money here. Every figure, and every total, comes
// from the database. Totals rows are Excel SUM formulas that also carry the
// database's total, so a file is right even before Excel recalculates.

export const MONEY = '"R" #,##0.00'
export const HOURS = '0.00'
export const DATE = 'dd mmm yyyy'
export const DATE_TIME = 'dd mmm yyyy hh:mm'
// The database sends percentages as e.g. 42.9 - shown as "42.9%".
export const PERCENT = '0.0"%"'
export const WHOLE = '0'

export const CONFIDENTIAL = 'Confidential – contains personal information (POPIA)'
export const VAT_NOTE = 'Receipt amounts are the total paid, VAT inclusive.'
export const PROVISIONAL_NOTE =
  'Labour is provisional: hours × the rate on each day, overtime included per the pay rules, before deductions. Owned plant: hours × the machine rate.'

// PAY FILES (payroll hours sheet, pay run export, annual earnings). The top
// line of every sheet says what the file is:
//   all projects      -> the person's full pay
//   filtered projects -> only those projects' share of it: NEVER pay from it
export const PAY_TITLE = 'GROSS BEFORE DEDUCTIONS — NOT A PAYSLIP'
export const ALLOCATION_TITLE = 'PROJECT LABOUR COST ALLOCATION — NOT THE AMOUNT TO PAY EMPLOYEES'
export const PAY_ONLY_UNFILTERED = 'Pay employees only from the unfiltered (All projects) pay run.'
export const ALLOCATION_OT_NOTE =
  "Each project's share of a person's day: its share of the day's hours, of the ordinary and of the overtime hours and pay."

export const ALL_PROJECTS = 'All projects'

// projects: null (all projects) or [{ id, name }] - the projects chosen.
export const isFiltered = (projects) => Boolean(projects?.length)
export const isGrouped = (projects) => (projects?.length ?? 0) > 1

// "All projects", or the chosen projects' names.
export function projectsLabel(projects) {
  return isFiltered(projects) ? projects.map((project) => project.name).join(', ') : ALL_PROJECTS
}

// The top line of a pay file, for the projects chosen.
export const payTitle = (projects) => (isFiltered(projects) ? ALLOCATION_TITLE : PAY_TITLE)

const FORMATS = { money: MONEY, hours: HOURS, date: DATE, percent: PERCENT, whole: WHOLE }

// "2026-03-02" -> a real Excel date for that day (no time-zone shift).
export function excelDate(isoDate) {
  if (!isoDate) return null
  const [year, month, day] = isoDate.slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

// The time on this device, as Excel should show it.
function excelNow(now) {
  return new Date(
    Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes(), now.getSeconds()),
  )
}

// A number from the database (it may arrive as text) -> a real number.
export const num = (value) => (value === null || value === undefined ? null : Number(value))

const slug = (text) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'project'

// nkutwala_{report}_{projects-or-all}_{from}_{to}.xlsx
//   all projects: all-projects; one to three: their names joined with "+";
//   more: e.g. 5-projects
export function exportFilename(report, projects, from, to) {
  let part = 'all-projects'
  if (isFiltered(projects)) {
    part = projects.length > 3 ? `${projects.length}-projects` : projects.map((project) => slug(project.name)).join('+')
  }
  return `nkutwala_${report}_${part}_${from}_${to}.xlsx`
}

// What the export log records for an export: the projects chosen (ids and
// names; null = all projects), the dates and anything else that shaped it.
export function exportLogFilters({ projects, from, to, ...extra }) {
  return {
    projects: projectsLabel(projects),
    project_ids: isFiltered(projects) ? projects.map((project) => project.id) : null,
    project_names: isFiltered(projects) ? projects.map((project) => project.name) : null,
    from,
    to,
    ...extra,
  }
}

export function createWorkbook() {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Nkutwala Site Costing'
  workbook.created = new Date()
  // Excel works out the SUM rows again whenever the file is opened.
  workbook.calcProperties.fullCalcOnLoad = true
  return workbook
}

// One sheet: the title rows, then a table with a bold frozen header,
// filters, sensible widths and (optionally) totals.
//   meta:    { report, banner, company, projects, from, to, generatedBy, generatedAt }
//            banner:   a line above the report name, large, bold and red
//                      (pay files: PAY_TITLE or ALLOCATION_TITLE)
//            projects: null (all projects) or [{ id, name }]
//   notes:   extra lines under the title (shown bold), e.g. CONFIDENTIAL
//   columns: [{ header, key, type: 'text'|'money'|'hours'|'date'|'percent'|'whole', width, dateHeader }]
//            dateHeader: the header is a date ("YYYY-MM-DD"), shown as a real date
//   rows:    [{ [key]: value }] - values exactly as the database sent them
//   totals:  { [key]: the database's grand total } - a SUM formula carrying
//            it; or { [key]: null } for a formula Excel works out on opening
//   groups:  two or more projects: { key, projects, totals }. The rows are
//            written project by project (projects: [{ id, name }] in order;
//            row[key] is the row's project id), each project followed by a
//            "Subtotal: {name}" row - SUM formulas carrying the database's
//            subtotals, totals(row) from any of that project's rows - and
//            the "Total" row adds up the subtotal rows. A project with
//            nothing in the period still gets its line and a zero subtotal.
// Returns { sheet, written }: written = [{ row, number }], each data row
// and the sheet row it went on.
export function addTableSheet(workbook, { name, meta, notes = [], columns, rows, totals, groups }) {
  const sheet = workbook.addWorksheet(name)

  // --- Title rows -------------------------------------------------------------
  if (meta.banner) sheet.addRow([meta.banner]).font = { bold: true, size: 14, color: { argb: 'FFC20116' } }
  sheet.addRow([meta.report]).font = { bold: true, size: meta.banner ? 12 : 14 }
  sheet.addRow(['Company', meta.company])
  sheet.addRow([isGrouped(meta.projects) ? 'Projects' : 'Project', projectsLabel(meta.projects)])
  sheet.addRow(['Period', `${formatDate(meta.from)} – ${formatDate(meta.to)}`])
  const generated = sheet.addRow(['Generated', excelNow(meta.generatedAt)])
  generated.getCell(2).numFmt = DATE_TIME
  generated.getCell(2).alignment = { horizontal: 'left' }
  sheet.addRow(['Generated by', meta.generatedBy])
  for (const line of notes) {
    sheet.addRow([line]).font = { bold: true, color: { argb: 'FFC20116' } }
  }
  sheet.addRow([])

  // --- Header -----------------------------------------------------------------
  const header = sheet.addRow(columns.map((column) => (column.dateHeader ? excelDate(column.header) : column.header)))
  const headerRow = header.number
  header.font = { bold: true }
  columns.forEach((column, index) => {
    if (column.dateHeader) header.getCell(index + 1).numFmt = 'dd mmm'
  })
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE9E9EB' } }
    cell.border = { bottom: { style: 'thin' } }
    cell.alignment = { vertical: 'middle', wrapText: true }
  })
  sheet.views = [{ state: 'frozen', ySplit: headerRow }]
  sheet.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow, column: columns.length } }

  // --- Data -------------------------------------------------------------------
  const written = []
  function addDataRow(row) {
    const added = sheet.addRow(
      columns.map(({ key, type }) => {
        const value = row[key]
        if (value === null || value === undefined || value === '') return null
        if (type === 'date') return excelDate(value)
        if (type && type !== 'text') return num(value)
        return value
      }),
    )
    columns.forEach(({ type }, index) => {
      if (FORMATS[type]) added.getCell(index + 1).numFmt = FORMATS[type]
    })
    written.push({ row, number: added.number })
  }

  // A totals row: for each key in `values` (the database's figures), a
  // formula carrying that figure - or, when there is nothing above it, just
  // the figure (or 0).
  function addTotalsRow(label, values, formulaFor, empty) {
    const total = sheet.addRow([])
    total.getCell(1).value = label
    total.font = { bold: true }
    columns.forEach(({ key, type }, index) => {
      if (!(key in values)) return
      const cell = total.getCell(index + 1)
      const formula = formulaFor(sheet.getColumn(index + 1).letter)
      const result = num(values[key])
      cell.value = empty ? (result ?? 0) : result === null ? { formula } : { formula, result }
      if (FORMATS[type]) cell.numFmt = FORMATS[type]
      cell.border = { top: { style: 'thin' } }
    })
    return total.number
  }

  if (!groups) {
    const firstDataRow = headerRow + 1
    for (const row of rows) addDataRow(row)
    if (rows.length === 0) sheet.addRow(['Nothing in this period']).font = { italic: true }
    const lastDataRow = sheet.lastRow.number
    if (totals) {
      addTotalsRow('Total', totals, (letter) => `SUM(${letter}${firstDataRow}:${letter}${lastDataRow})`, rows.length === 0)
    }
  } else {
    // --- Project by project, each with its subtotal --------------------------
    const subtotalRows = []
    for (const project of groups.projects) {
      const own = rows.filter((row) => row[groups.key] === project.id)
      const first = sheet.lastRow.number + 1
      for (const row of own) addDataRow(row)
      if (own.length === 0) sheet.addRow(['Nothing for this project in this period']).font = { italic: true }
      const last = sheet.lastRow.number
      const subtotals = own.length ? groups.totals(own[0]) : {}
      const values = Object.fromEntries(Object.keys(totals ?? {}).map((key) => [key, subtotals[key] ?? null]))
      subtotalRows.push(
        addTotalsRow(`Subtotal: ${project.name}`, values, (letter) => `SUM(${letter}${first}:${letter}${last})`, own.length === 0),
      )
    }
    // --- Grand total: the subtotal rows added up --------------------------------
    if (totals) {
      addTotalsRow('Total', totals, (letter) => subtotalRows.map((number) => `${letter}${number}`).join('+'), rows.length === 0)
    }
  }

  // --- Widths -----------------------------------------------------------------
  columns.forEach((column, index) => {
    sheet.getColumn(index + 1).width = column.width ?? Math.max(12, Math.min(40, String(column.header).length + 2))
  })
  sheet.getColumn(1).width = Math.max(sheet.getColumn(1).width, 16)

  return { sheet, written }
}

// The `groups` option of addTableSheet for a sheet whose rows carry
// project_id: only when two or more projects were chosen.
//   totals(row): that project's subtotals, from the database (row.project_total_...)
export function projectGroups(projects, totals) {
  return isGrouped(projects) ? { key: 'project_id', projects, totals } : undefined
}

// The company name and who is exporting, for the title rows.
export async function fetchExportMeta(client, userId) {
  const [company, profile] = await Promise.all([
    client.from('companies').select('name').limit(1).maybeSingle(),
    client.from('profiles').select('full_name').eq('id', userId).maybeSingle(),
  ])
  if (company.error) throw company.error
  if (profile.error) throw profile.error
  return { company: company.data?.name ?? '', generatedBy: profile.data?.full_name ?? '' }
}

export async function call(client, fn, args) {
  const { data, error } = await client.rpc(fn, args)
  if (error) throw error
  return data
}
