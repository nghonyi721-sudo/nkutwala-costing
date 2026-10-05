// The levels of the dashboard drill-down. Each one remembers the project
// (null = all projects) and the period of the figure that was tapped, so its
// total equals that figure. label is its step in the breadcrumbs.

export const spendingLevel = (projectId, projectName, period) => ({
  kind: 'spending',
  label: projectName ?? 'All projects',
  projectId,
  projectName,
  period,
})

// Labour and owned plant: per person / machine. Everything else: receipts.
export function categoryLevel(category, label, projectId, period) {
  return category === 'labour' || category === 'owned_plant'
    ? { kind: 'hours', category, label, projectId, period }
    : { kind: 'receipts', category, vendor: null, label, projectId, period }
}

// Approved receipts of every category (the "Receipts" part of the mix).
export const allReceiptsLevel = (projectId, period) => ({
  kind: 'receipts',
  category: null,
  vendor: null,
  label: 'Receipts',
  projectId,
  period,
})

export const vendorLevel = (vendor, projectId, period) => ({
  kind: 'receipts',
  category: null,
  vendor,
  label: vendor,
  projectId,
  period,
})

export const unpricedLevel = (projectId, period) => ({ kind: 'unpriced', label: 'Unpriced hours', projectId, period })

export const employeeLevel = (employeeId, name, projectId, period) => ({
  kind: 'employee',
  label: name,
  employeeId,
  projectId,
  period,
})

export const reportLevel = (reportId, label) => ({ kind: 'report', label, reportId })
