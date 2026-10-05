// Browser only: save a built workbook as a file on this device.
// Every export is written to export_log FIRST; if that fails, there is no
// file - so no export ever goes unlogged.

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

//   type:    the report type, e.g. 'project_cost'
//   filters: what was chosen, e.g. { project_id, project_name, from, to }
export async function saveExport(client, { type, filters, workbook, filename }) {
  const { error } = await client.from('export_log').insert({ report_type: type, filters })
  if (error) throw error

  const buffer = await workbook.xlsx.writeBuffer()
  const url = URL.createObjectURL(new Blob([buffer], { type: XLSX_TYPE }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  // Give the browser a moment to start the download before letting go.
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}
