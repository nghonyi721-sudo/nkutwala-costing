// People and project teams, in small steps. Each step takes the Supabase
// connection to use, so the app and the attack test
// (scripts/rls-attack-test.mjs) run exactly the same code.
// Plain JavaScript on purpose: no app-only imports, so Node can load it too.
//
// The database decides everything that matters: everyone added starts as
// Pending, who added them comes from the login, only owners/admins approve
// (and never without a rate), and only owners/admins can see or send rates.

// The columns of an employee the app reads. Employees have no money columns.
// first_names is worked out by the database (the full name without the
// surname).
export const EMPLOYEE_COLUMNS =
  'id, full_name, first_names, surname, category, phone, status, active, created_by, approved_at, rejected_at, reject_reason'

// Owner/admin screens also read whether someone is UIF registered (only
// owners and admins can change it - the database checks).
export const OWNER_EMPLOYEE_COLUMNS = `${EMPLOYEE_COLUMNS}, uif_registered`

const tidy = (text) => (text ?? '').trim().replace(/\s+/g, ' ')

// The full name the database keeps: first name(s), then the surname if there
// is one (the database checks the full name ends with the surname).
export const fullNameOf = ({ firstNames, surname }) => [tidy(firstNames), tidy(surname)].filter(Boolean).join(' ')

// A person's name as the forms show it: { firstNames, surname }.
export const nameParts = (person) => ({
  firstNames: person?.first_names ?? person?.full_name ?? '',
  surname: person?.surname ?? '',
})

const nameValues = (details) => ({ full_name: fullNameOf(details), surname: tidy(details.surname) || null })

// Add someone new. Returns them as stored: always Pending.
//   uifRegistered: owners/admins only (the database refuses anyone else)
export async function addEmployee(client, { firstNames, surname, category, phone, uifRegistered = false }) {
  const { data, error } = await client
    .from('employees')
    .insert({
      ...nameValues({ firstNames, surname }),
      category,
      phone: phone?.trim() || null,
      ...(uifRegistered ? { uif_registered: true } : {}),
    })
    .select(EMPLOYEE_COLUMNS)
    .single()
  if (error) throw error
  return data
}

// Fix the name, category or phone of a person. Site managers may only do
// this for the pending people they added. Returns them as stored.
export async function updateEmployeeDetails(client, employeeId, { firstNames, surname, category, phone }) {
  const { data, error } = await client
    .from('employees')
    .update({ ...nameValues({ firstNames, surname }), category, phone: phone?.trim() || null })
    .eq('id', employeeId)
    .select(EMPLOYEE_COLUMNS)
  if (error) throw error
  if (data.length === 0) throw new Error('This person can no longer be changed.')
  return data[0]
}

// People in the company with the same name (capitals and extra spaces don't
// count): [{ id, full_name, category, status }].
export async function findDuplicates(client, fullName) {
  const { data, error } = await client.rpc('employee_duplicates', { p_full_name: fullName })
  if (error) throw error
  return data
}

// Put someone on a project's team, or back on it.
export async function assignToProject(client, projectId, employeeId) {
  const { error } = await client.rpc('assign_to_project', {
    p_project_id: projectId,
    p_employee_id: employeeId,
  })
  if (error) throw error
}

// Take someone off a project's team. The row is kept, switched off.
export async function removeFromProject(client, projectId, employeeId) {
  const { error } = await client
    .from('project_employees')
    .update({ active: false })
    .eq('project_id', projectId)
    .eq('employee_id', employeeId)
    .select('id')
  if (error) throw error
}

// A project's team: everyone on it who isn't inactive, by name.
export async function fetchTeam(client, projectId) {
  const { data, error } = await client
    .from('project_employees')
    .select(`employee:employees(${EMPLOYEE_COLUMNS})`)
    .eq('project_id', projectId)
    .eq('active', true)
  if (error) throw error
  return data
    .map((row) => row.employee)
    .filter((employee) => employee && employee.status !== 'inactive')
    .sort((a, b) => a.full_name.localeCompare(b.full_name))
}

// OWNERS/ADMINS ONLY (the server refuses anyone else): save the hourly rate
// and approve, in one all-or-nothing step.
export async function approveEmployee(client, employeeId, hourlyRate, effectiveFrom) {
  const { error } = await client.rpc('approve_employee', {
    p_employee_id: employeeId,
    p_hourly_rate: hourlyRate,
    p_effective_from: effectiveFrom,
  })
  if (error) throw error
}

// OWNERS/ADMINS ONLY: reject a new employee, with a reason. They become
// inactive; the reason is kept.
export async function rejectEmployee(client, employeeId, reason) {
  const { data, error } = await client
    .from('employees')
    .update({ status: 'inactive', reject_reason: reason.trim() })
    .eq('id', employeeId)
    .eq('status', 'pending')
    .select('id')
  if (error) throw error
  if (data.length === 0) throw new Error('This person is no longer waiting for approval.')
}
