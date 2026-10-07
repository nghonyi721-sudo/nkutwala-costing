import { supabase } from '../supabaseClient'

// OWNER/ADMIN SCREENS ONLY. Runs an export: fetch the figures (the database
// refuses anyone else), build the workbook, log it, save the file. The
// Excel code is only downloaded the first time someone exports.
// Nothing is kept on the device except the saved file itself.
//   projects: null (all projects) or [{ id, name }] - the projects chosen

async function who() {
  const { data } = await supabase.auth.getSession()
  const userId = data.session?.user?.id
  if (!userId) throw new Error('Not logged in')
  const { fetchExportMeta } = await import('./workbook.js')
  return fetchExportMeta(supabase, userId)
}

// A period preset's dates for the chosen projects, worked out by the
// database like the dashboard's: { from_date, to_date } or null.
export async function fetchExportPeriod(preset, projects) {
  const { data, error } = await supabase.rpc('export_period', {
    p_preset: preset,
    p_project_ids: projects?.length ? projects.map((project) => project.id) : null,
  })
  if (error) throw error
  return data?.[0] ?? null
}

// Export 1. from/to: "YYYY-MM-DD".
export async function exportProjectCost({ projects, from, to }) {
  const [{ PROJECT_COST, buildProjectCost, fetchProjectCost }, { exportLogFilters }, { saveExport }] = await Promise.all([
    import('./projectCost.js'),
    import('./workbook.js'),
    import('./download.js'),
  ])
  const [data, meta] = await Promise.all([fetchProjectCost(supabase, { projects, from, to }), who()])
  const built = buildProjectCost(data, { ...meta, projects, from, to, generatedAt: new Date() })
  await saveExport(supabase, { type: PROJECT_COST.type, filters: exportLogFilters({ projects, from, to }), ...built })
}

// The pay-run Excel: one version of a closed pay period, from its snapshot.
//   period: { id, start_date, end_date }; run: a row of pay_run_versions
export async function exportPayRun({ period, run, projects }) {
  const [{ PAY_RUN, buildPayRun, fetchPayRun }, { exportLogFilters, isFiltered }, { saveExport }] = await Promise.all([
    import('./payRun.js'),
    import('./workbook.js'),
    import('./download.js'),
  ])
  const from = period.start_date
  const to = period.end_date
  const [data, meta] = await Promise.all([fetchPayRun(supabase, { runId: run.run_id, projects }), who()])
  const built = buildPayRun(data, { ...meta, projects, from, to, run, generatedAt: new Date() })
  await saveExport(supabase, {
    type: PAY_RUN.type,
    filters: exportLogFilters({
      projects,
      from,
      to,
      allocation: isFiltered(projects),
      period_id: period.id,
      run_id: run.run_id,
      version: run.version,
    }),
    ...built,
  })
}

// Export 2. All projects: full pay. Chosen projects: a labour cost
// allocation (logged as such).
export async function exportPayrollHours({ projects, from, to }) {
  const [{ PAYROLL_HOURS, buildPayrollHours, fetchPayrollHours }, { exportLogFilters, isFiltered }, { saveExport }] =
    await Promise.all([import('./payrollHours.js'), import('./workbook.js'), import('./download.js')])
  const [data, meta] = await Promise.all([fetchPayrollHours(supabase, { projects, from, to }), who()])
  const built = buildPayrollHours(data, { ...meta, projects, from, to, generatedAt: new Date() })
  await saveExport(supabase, {
    type: PAYROLL_HOURS.type,
    filters: exportLogFilters({ projects, from, to, allocation: isFiltered(projects) }),
    ...built,
  })
}
