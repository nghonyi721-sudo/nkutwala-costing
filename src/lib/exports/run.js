import { supabase } from '../supabaseClient'

// OWNER/ADMIN SCREENS ONLY. Runs an export: fetch the figures (the database
// refuses anyone else), build the workbook, log it, save the file. The
// Excel code is only downloaded the first time someone exports.
// Nothing is kept on the device except the saved file itself.

async function who() {
  const { data } = await supabase.auth.getSession()
  const userId = data.session?.user?.id
  if (!userId) throw new Error('Not logged in')
  const { fetchExportMeta } = await import('./workbook.js')
  return fetchExportMeta(supabase, userId)
}

// Export 1. projectId null = all projects; from/to: "YYYY-MM-DD".
export async function exportProjectCost({ projectId, projectName, from, to }) {
  const [{ PROJECT_COST, buildProjectCost, fetchProjectCost }, { saveExport }] = await Promise.all([
    import('./projectCost.js'),
    import('./download.js'),
  ])
  const [data, meta] = await Promise.all([fetchProjectCost(supabase, { projectId, from, to }), who()])
  const built = buildProjectCost(data, { ...meta, projectName, from, to, generatedAt: new Date() })
  await saveExport(supabase, {
    type: PROJECT_COST.type,
    filters: { project_id: projectId, project_name: projectName ?? 'All projects', from, to },
    ...built,
  })
}

// Export 2: all projects.
export async function exportPayrollHours({ from, to }) {
  const [{ PAYROLL_HOURS, buildPayrollHours, fetchPayrollHours }, { saveExport }] = await Promise.all([
    import('./payrollHours.js'),
    import('./download.js'),
  ])
  const [data, meta] = await Promise.all([fetchPayrollHours(supabase, { from, to }), who()])
  const built = buildPayrollHours(data, { ...meta, from, to, generatedAt: new Date() })
  await saveExport(supabase, { type: PAYROLL_HOURS.type, filters: { from, to }, ...built })
}
