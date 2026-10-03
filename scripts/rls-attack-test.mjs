// Rate Wall attack test.
//
// Logs in as the site_manager test user with the PUBLIC (anon) key - exactly
// what the app or an attacker with the app's key could do - and tries to get
// or change data it must never touch. The owner test user sets up test data
// first and confirms afterwards that nothing changed, which also proves the
// test itself works.
//
// Run with:  npm run test:rls
//
// Needs in .env: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY,
//   TEST_SITE_EMAIL, TEST_SITE_PASSWORD, TEST_OWNER_EMAIL, TEST_OWNER_PASSWORD
//
// NEVER give this script a service_role / secret key: that key ignores all
// security rules, so every attack would "succeed" and the test would be
// meaningless. The guard below refuses to run with one.
//
// Test data: "ZZ RLS Test Employee" (inactive) and "ZZ RLS Test Project"
// (complete) are created once and reused, because nothing can be deleted.

import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)))

const url = process.env.VITE_SUPABASE_URL
const anonKey = process.env.VITE_SUPABASE_ANON_KEY

const TEST_EMPLOYEE_NAME = 'ZZ RLS Test Employee'
const TEST_EMPLOYEE_2_NAME = 'ZZ RLS Test Employee 2'
const TEST_PROJECT_NAME = 'ZZ RLS Test Project'
const TEST_EQUIPMENT_NAME = 'ZZ RLS Test Equipment'
const TEST_RATES = [
  { hourly_rate: 100, effective_from: '2026-01-01' },
  { hourly_rate: 120, effective_from: '2026-06-01' },
]
// Reports can't be deleted, so the test reuses one report per manager on
// this date. The owner reopens site manager 1's report at the end of each run.
const TEST_REPORT_DATE = '2026-01-15'
const FORGED_REPORT_DATE = '2026-01-16'

// Columns site managers are allowed to receive. Anything else in a response
// (e.g. a budget or rate column added later) makes the test FAIL.
const ALLOWED_COLUMNS = {
  projects: ['id', 'company_id', 'name', 'contract_number', 'status', 'created_at'],
  employees: ['id', 'company_id', 'full_name', 'category', 'active', 'created_at'],
  equipment: ['id', 'company_id', 'name', 'ownership', 'active', 'created_at'],
  daily_reports: [
    'id', 'company_id', 'project_id', 'report_date', 'reporter_id',
    'start_time', 'end_time', 'rain_percent', 'delay_hours', 'fuel_litres',
    'dsti_done', 'internal_audit', 'near_miss', 'safety_moment', 'activities',
    'status', 'submitted_at', 'reopened_at', 'reopened_by', 'reopen_reason',
    'created_at', 'updated_at',
  ],
  report_crew: ['id', 'report_id', 'employee_id', 'hours', 'created_at'],
  report_equipment: ['id', 'report_id', 'equipment_id', 'hours', 'created_at'],
}

const results = []

function record(name, passed, detail) {
  results.push(passed)
  const number = String(results.length).padStart(2, ' ')
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${number}. ${name}\n          ${detail}`)
}

function stop(message) {
  console.error(`\nSTOPPED: ${message}`)
  process.exit(1)
}

// --- Safety guard: only a public key is allowed -------------------------------
function keyType(key) {
  if (key.startsWith('sb_publishable_')) return 'public'
  if (key.startsWith('sb_secret_')) return 'secret'
  try {
    // Older Supabase keys are JWTs; the middle part says which role the key has.
    const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString())
    if (payload.role === 'anon') return 'public'
    if (payload.role === 'service_role') return 'secret'
  } catch {
    // not a JWT - fall through
  }
  return 'unknown'
}

for (const name of [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'TEST_SITE_EMAIL',
  'TEST_SITE_PASSWORD',
  'TEST_OWNER_EMAIL',
  'TEST_OWNER_PASSWORD',
  'TEST_SITE2_EMAIL',
  'TEST_SITE2_PASSWORD',
]) {
  if (!process.env[name]) stop(`${name} is missing from .env`)
}

const type = keyType(anonKey)
if (type === 'secret') {
  stop('VITE_SUPABASE_ANON_KEY is a service_role / secret key. Use the anon (public) key only.')
}
if (type !== 'public') {
  stop('VITE_SUPABASE_ANON_KEY is not recognised as an anon (public) key.')
}

// --- Helpers -------------------------------------------------------------------
async function signIn(email, password) {
  // A fresh connection per user that doesn't save the login anywhere.
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error) stop(`could not log in as ${email}: ${error.message}`)
  return { client, userId: data.user.id }
}

async function readOwnRole(client, userId) {
  const { data, error } = await client
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle()
  if (error || !data) return null
  return data.role
}

// Postgres "permission denied" / "row-level security violation" - the server
// refused outright.
const PERMISSION_DENIED = '42501'

// Find the test row by name, or create it. Runs as the owner.
async function findOrCreate(client, table, nameColumn, values) {
  const { data, error } = await client
    .from(table)
    .select('id')
    .eq(nameColumn, values[nameColumn])
    .limit(1)
  if (error) stop(`owner setup: could not read ${table}: ${error.message}`)
  if (data.length > 0) return data[0].id

  const { data: created, error: insertError } = await client
    .from(table)
    .insert(values)
    .select('id')
    .single()
  if (insertError) stop(`owner setup: could not create test row in ${table}: ${insertError.message}`)
  return created.id
}

// Live (not voided) rates of the test employee, as seen by the owner.
async function liveTestRates(client, employeeId) {
  const { data, error } = await client
    .from('employee_rates')
    .select('id, hourly_rate, effective_from')
    .eq('employee_id', employeeId)
    .is('voided_at', null)
  if (error) stop(`owner could not read test rates: ${error.message}`)
  return data
}

// An insert that must NOT be allowed. By default it must be refused for lack
// of permission; pass expectedCode when it must be refused for a specific
// reason (e.g. a limit or a duplicate), so a refusal for some other reason
// can't be mistaken for a pass.
async function attackInsert(
  name,
  client,
  table,
  values,
  expectedCode = PERMISSION_DENIED,
  refusedBecause = 'Server refused.',
) {
  const { data, error } = await client.from(table).insert(values).select('id')
  if (error?.code === expectedCode) {
    record(name, true, refusedBecause)
  } else if (error) {
    record(name, false, `Refused for the wrong reason (${error.code}): ${error.message}`)
  } else {
    record(
      name,
      false,
      `BREACH: ${data?.length ?? 'a'} row(s) were created in ${table}. Mark them inactive/complete/voided NOW.`,
    )
  }
}

// An update the site manager must NOT be allowed to do. Afterwards the owner
// re-reads the row to make sure nothing really changed.
async function attackUpdate(name, site, owner, table, id, changes, column) {
  const { data: before } = await owner.client.from(table).select(column).eq('id', id).single()
  const { data, error } = await site.client.from(table).update(changes).eq('id', id).select('id')
  const { data: after } = await owner.client.from(table).select(column).eq('id', id).single()

  const refused = error?.code === PERMISSION_DENIED
  const changedNothing = !error && data.length === 0

  if (error && !refused) {
    record(name, false, `Unexpected error: ${error.message}`)
  } else if (!before || !after || before[column] !== after[column]) {
    record(name, false, `BREACH: ${column} changed from "${before?.[column]}" to "${after?.[column]}".`)
  } else if (refused || changedNothing) {
    record(name, true, `${refused ? 'Server refused' : 'Server changed nothing'}; owner confirms no change.`)
  } else {
    record(name, false, 'Update reported success.')
  }
}

// A read that must return nothing to the site manager.
async function attackReadNothing(name, client, table) {
  const { data, error } = await client.from(table).select('*')
  if (error?.code === PERMISSION_DENIED) {
    record(name, true, 'Server refused (permission denied).')
  } else if (error) {
    record(name, false, `Unexpected error: ${error.message}`)
  } else if (data.length > 0) {
    record(name, false, `LEAK: ${data.length} row(s) of ${table} were sent to a site manager.`)
  } else {
    record(name, true, 'Zero rows came back.')
  }
}

console.log('\nRate Wall attack test\n')

// =============================================================================
// Owner setup
// =============================================================================
console.log('Logging in as the owner test user and preparing test data…\n')

const owner = await signIn(process.env.TEST_OWNER_EMAIL, process.env.TEST_OWNER_PASSWORD)

const ownerRole = await readOwnRole(owner.client, owner.userId)
if (ownerRole !== 'owner') {
  stop(
    `the TEST_OWNER_EMAIL user's role is "${ownerRole ?? 'unreadable'}", not owner. ` +
      'Fix the role in the profiles table, then run again.',
  )
}

const testEmployeeId = await findOrCreate(owner.client, 'employees', 'full_name', {
  full_name: TEST_EMPLOYEE_NAME,
  category: 'general_worker',
  active: false,
})
const testProjectId = await findOrCreate(owner.client, 'projects', 'name', {
  name: TEST_PROJECT_NAME,
  status: 'complete',
})
const testEmployee2Id = await findOrCreate(owner.client, 'employees', 'full_name', {
  full_name: TEST_EMPLOYEE_2_NAME,
  category: 'general_worker',
  active: false,
})
const testEquipmentId = await findOrCreate(owner.client, 'equipment', 'name', {
  name: TEST_EQUIPMENT_NAME,
  ownership: 'own',
  active: false,
})

{
  const existing = await liveTestRates(owner.client, testEmployeeId)
  for (const rate of TEST_RATES) {
    const match = existing.find((r) => r.effective_from === rate.effective_from)
    if (match && Number(match.hourly_rate) !== rate.hourly_rate) {
      stop(
        `${TEST_EMPLOYEE_NAME} already has a live rate of ${match.hourly_rate} from ` +
          `${rate.effective_from}. Void it in the app, then run again.`,
      )
    }
    if (!match) {
      const { error } = await owner.client
        .from('employee_rates')
        .insert({ employee_id: testEmployeeId, ...rate })
      if (error) stop(`owner setup: could not add test rate: ${error.message}`)
    }
  }
}

// =============================================================================
// Attacks as the site manager
// =============================================================================
console.log('Logging in as the site manager test user and attacking…\n')

const site = await signIn(process.env.TEST_SITE_EMAIL, process.env.TEST_SITE_PASSWORD)

const startingRole = await readOwnRole(site.client, site.userId)
if (startingRole !== 'site_manager') {
  stop(
    `the TEST_SITE_EMAIL user's role is "${startingRole ?? 'unreadable'}", not site_manager. ` +
      'Fix the role in the profiles table, then run again.',
  )
}

// --- Profiles ------------------------------------------------------------------
{
  const name = 'Site manager reads all profiles'
  const { data, error } = await site.client.from('profiles').select('id, role')
  if (error) {
    record(name, false, `Unexpected error: ${error.message}`)
  } else {
    const others = data.filter((row) => row.id !== site.userId)
    const sawOwn = data.some((row) => row.id === site.userId)
    if (others.length > 0) {
      record(name, false, `LEAK: could see ${others.length} other person's profile(s).`)
    } else if (!sawOwn) {
      record(name, false, 'Inconclusive: could not even see their own profile.')
    } else {
      record(name, true, 'Only their own profile came back.')
    }
  }
}

{
  const name = 'Site manager makes themselves owner'
  const { data, error } = await site.client
    .from('profiles')
    .update({ role: 'owner' })
    .eq('id', site.userId)
    .select('role')

  const refused = error?.code === PERMISSION_DENIED
  const changedNothing = !error && data.length === 0
  const roleAfter = await readOwnRole(site.client, site.userId)

  if (error && !refused) {
    record(name, false, `Unexpected error: ${error.message}`)
  } else if (roleAfter !== 'site_manager') {
    record(
      name,
      false,
      `BREACH: role is now "${roleAfter ?? 'unreadable'}". Reset it in the profiles table NOW.`,
    )
  } else if (refused || changedNothing) {
    record(
      name,
      true,
      `${refused ? 'Server refused (permission denied)' : 'Server changed nothing'}; role is still site_manager.`,
    )
  } else {
    record(name, false, 'Update reported success.')
  }
}

// --- Owner-only tables ---------------------------------------------------------
await attackReadNothing('Site manager reads owner_only_test', site.client, 'owner_only_test')
await attackReadNothing('Site manager reads employee_rates', site.client, 'employee_rates')
await attackReadNothing('Site manager reads audit_log', site.client, 'audit_log')

await attackInsert('Site manager adds a rate', site.client, 'employee_rates', {
  employee_id: testEmployeeId,
  hourly_rate: 1,
  effective_from: '2030-01-01',
})

{
  const name = 'Site manager calls rate_on()'
  const { data, error } = await site.client.rpc('rate_on', {
    p_employee_id: testEmployeeId,
    p_date: '2026-03-15',
  })
  if (error?.code === PERMISSION_DENIED) {
    record(name, true, 'Server refused (permission denied).')
  } else if (error) {
    record(name, false, `Unexpected error: ${error.message}`)
  } else if (data !== null) {
    record(name, false, `LEAK: rate_on returned ${data} to a site manager.`)
  } else {
    record(name, true, 'Returned nothing.')
  }
}

{
  const name = 'Site manager voids a rate'
  const ratesBefore = await liveTestRates(owner.client, testEmployeeId)
  const { data, error } = await site.client
    .from('employee_rates')
    .update({ void_reason: 'attack test' })
    .eq('employee_id', testEmployeeId)
    .select('id')
  const ratesAfter = await liveTestRates(owner.client, testEmployeeId)

  const refused = error?.code === PERMISSION_DENIED
  const changedNothing = !error && data.length === 0

  if (error && !refused) {
    record(name, false, `Unexpected error: ${error.message}`)
  } else if (ratesAfter.length !== ratesBefore.length) {
    record(
      name,
      false,
      `BREACH: ${ratesBefore.length - ratesAfter.length} rate(s) were voided. Re-add them in the app.`,
    )
  } else if (refused || changedNothing) {
    record(name, true, `${refused ? 'Server refused' : 'Server changed nothing'}; owner confirms rates are untouched.`)
  } else {
    record(name, false, 'Update reported success.')
  }
}

// --- Projects and employees: read yes, write no --------------------------------
await attackInsert('Site manager adds a project', site.client, 'projects', {
  name: 'ZZ attack project',
})
await attackUpdate(
  'Site manager renames a project',
  site,
  owner,
  'projects',
  testProjectId,
  { name: 'HACKED' },
  'name',
)
await attackInsert('Site manager adds an employee', site.client, 'employees', {
  full_name: 'ZZ attack employee',
  category: 'general_worker',
})
await attackUpdate(
  'Site manager renames an employee',
  site,
  owner,
  'employees',
  testEmployeeId,
  { full_name: 'HACKED' },
  'full_name',
)

// =============================================================================
// Daily reports (phase 3)
// =============================================================================
console.log('\nDaily report attacks…\n')

// The test report of a given manager, or null.
async function testReportOf(client, reporterId) {
  const { data, error } = await client
    .from('daily_reports')
    .select('id, status')
    .eq('project_id', testProjectId)
    .eq('report_date', TEST_REPORT_DATE)
    .eq('reporter_id', reporterId)
    .maybeSingle()
  if (error) stop(`could not look up the test report: ${error.message}`)
  return data
}

async function findOrCreateOwnReport(client, reporterId, who) {
  const existing = await testReportOf(client, reporterId)
  if (existing) return existing.id
  const { data, error } = await client
    .from('daily_reports')
    .insert({
      project_id: testProjectId,
      report_date: TEST_REPORT_DATE,
      activities: `RLS attack test report (${who})`,
    })
    .select('id')
    .single()
  if (error) stop(`${who} could not create their own test report: ${error.message}`)
  return data.id
}

// A delete that must NOT be allowed; the owner confirms the row still exists.
async function attackDelete(name, client, table, id) {
  const { data, error } = await client.from(table).delete().eq('id', id).select('id')
  const { data: still } = await owner.client.from(table).select('id').eq('id', id)

  if (!still || still.length !== 1) {
    record(name, false, `BREACH: the ${table} row is gone.`)
  } else if (error?.code === PERMISSION_DENIED) {
    record(name, true, 'Server refused; owner confirms it still exists.')
  } else if (error) {
    record(name, false, `Unexpected error: ${error.message}`)
  } else if (data.length === 0) {
    record(name, true, 'Server deleted nothing; owner confirms it still exists.')
  } else {
    record(name, false, 'Delete reported success.')
  }
}

// If an earlier run stopped half-way, site manager 1's report may still be
// submitted. The owner reopens it so this run starts from a draft.
{
  const leftover = await testReportOf(owner.client, site.userId)
  if (leftover?.status === 'submitted') {
    const { error } = await owner.client
      .from('daily_reports')
      .update({ status: 'draft', reopen_reason: 'RLS attack test: reset after an interrupted run' })
      .eq('id', leftover.id)
    if (error) stop(`owner could not reset the test report: ${error.message}`)
  }
}

// Site manager 1: their own draft, with one crew line and one equipment line,
// and test employee 2 NOT on it (so the attacks below can't hit a duplicate).
const report1Id = await findOrCreateOwnReport(site.client, site.userId, 'site manager 1')

async function ensureReport1Line(table, column, value, hours) {
  const { data, error } = await site.client
    .from(table)
    .select('id')
    .eq('report_id', report1Id)
    .eq(column, value)
    .maybeSingle()
  if (error) stop(`site manager 1 could not read their own ${table}: ${error.message}`)
  if (data) return data.id
  const { data: created, error: insertError } = await site.client
    .from(table)
    .insert({ report_id: report1Id, [column]: value, hours })
    .select('id')
    .single()
  if (insertError) stop(`site manager 1 could not add to their own draft: ${insertError.message}`)
  return created.id
}

const crewLine1Id = await ensureReport1Line('report_crew', 'employee_id', testEmployeeId, 8)
await ensureReport1Line('report_equipment', 'equipment_id', testEquipmentId, 4)
{
  const { error } = await site.client
    .from('report_crew')
    .delete()
    .eq('report_id', report1Id)
    .eq('employee_id', testEmployee2Id)
  if (error) stop(`site manager 1 could not remove a line from their own draft: ${error.message}`)
}
record(
  'Site manager 1 fills in their own draft report',
  true,
  'Report, crew line and equipment line saved (and a line removed) while draft.',
)

await attackInsert(
  'Site manager 1 files a report as the owner (forged reporter_id)',
  site.client,
  'daily_reports',
  { project_id: testProjectId, report_date: FORGED_REPORT_DATE, reporter_id: owner.userId },
)
await attackInsert(
  'Site manager 1 adds a crew line with 30 hours',
  site.client,
  'report_crew',
  { report_id: report1Id, employee_id: testEmployee2Id, hours: 30 },
  '23514',
  'Refused by the 24-hour limit.',
)
await attackInsert(
  'Site manager 1 files a second report for the same project and day',
  site.client,
  'daily_reports',
  { project_id: testProjectId, report_date: TEST_REPORT_DATE },
  '23505',
  'Refused as a duplicate.',
)

// --- Site manager 2, while report 1 is still a DRAFT --------------------------
console.log('\nLogging in as the second site manager test user…\n')

const site2 = await signIn(process.env.TEST_SITE2_EMAIL, process.env.TEST_SITE2_PASSWORD)
if (site2.userId === site.userId) stop('TEST_SITE2_EMAIL is the same user as TEST_SITE_EMAIL.')
{
  const role = await readOwnRole(site2.client, site2.userId)
  if (role !== 'site_manager') {
    stop(`the TEST_SITE2_EMAIL user's role is "${role ?? 'unreadable'}", not site_manager.`)
  }
}

{
  const name = "Site manager 2 reads site manager 1's report and crew"
  const [reportRead, crewRead] = await Promise.all([
    site2.client.from('daily_reports').select('id').eq('id', report1Id),
    site2.client.from('report_crew').select('id').eq('report_id', report1Id),
  ])
  const error = reportRead.error ?? crewRead.error
  const leaked = (reportRead.data?.length ?? 0) + (crewRead.data?.length ?? 0)
  if (error && error.code !== PERMISSION_DENIED) {
    record(name, false, `Unexpected error: ${error.message}`)
  } else if (leaked > 0) {
    record(name, false, `LEAK: ${leaked} row(s) of another manager's report came back.`)
  } else {
    record(name, true, 'Zero rows came back (the report was still a draft, so this is about ownership).')
  }
}

await attackInsert(
  "Site manager 2 adds a crew line to site manager 1's report",
  site2.client,
  'report_crew',
  { report_id: report1Id, employee_id: testEmployee2Id, hours: 2 },
)
await attackUpdate(
  "Site manager 2 edits site manager 1's report",
  site2,
  owner,
  'daily_reports',
  report1Id,
  { activities: 'HACKED by site manager 2' },
  'activities',
)

// --- Site manager 1 submits, then tries to change it --------------------------
{
  const name = 'Site manager 1 submits their report'
  const { data, error } = await site.client
    .from('daily_reports')
    .update({ status: 'submitted' })
    .eq('id', report1Id)
    .select('status, submitted_at')
  if (error || data.length !== 1 || data[0].status !== 'submitted' || !data[0].submitted_at) {
    record(name, false, `Could not submit: ${error?.message ?? 'no row updated'}`)
    stop('the remaining report checks need a submitted report.')
  }
  record(name, true, 'Submitted; the database stamped the time.')
}

await attackUpdate(
  'Site manager 1 edits their submitted report',
  site,
  owner,
  'daily_reports',
  report1Id,
  { activities: 'HACKED after submit' },
  'activities',
)
await attackUpdate(
  'Site manager 1 changes crew hours on their submitted report',
  site,
  owner,
  'report_crew',
  crewLine1Id,
  { hours: 23 },
  'hours',
)
await attackDelete(
  'Site manager 1 removes a crew line from their submitted report',
  site.client,
  'report_crew',
  crewLine1Id,
)
await attackDelete('Site manager 1 deletes their report', site.client, 'daily_reports', report1Id)

// --- Two managers, same project and day ---------------------------------------
{
  const report2Id = await findOrCreateOwnReport(site2.client, site2.userId, 'site manager 2')
  record(
    'Site manager 2 has their own report for the same project and day',
    report2Id !== report1Id,
    'Separate reports - the two managers cannot overwrite each other.',
  )

  const name = "Owner reads both managers' reports"
  const { data, error } = await owner.client
    .from('daily_reports')
    .select('id')
    .eq('project_id', testProjectId)
    .eq('report_date', TEST_REPORT_DATE)
  const ids = (data ?? []).map((row) => row.id)
  if (error) {
    record(name, false, `Error: ${error.message}`)
  } else if (!ids.includes(report1Id) || !ids.includes(report2Id)) {
    record(name, false, `Owner saw ${ids.length} report(s) but not both managers'.`)
  } else {
    record(name, true, `Owner sees both (${ids.length} report(s) for that project and day).`)
  }
}

await site2.client.auth.signOut()

// --- Owner: may reopen, may NOT edit --------------------------------------------
{
  const name = 'Owner changes the contents of a submitted report'
  const { data: before } = await owner.client
    .from('daily_reports')
    .select('activities')
    .eq('id', report1Id)
    .single()
  const { data, error } = await owner.client
    .from('daily_reports')
    .update({ activities: 'OWNER EDIT' })
    .eq('id', report1Id)
    .select('id')
  const { data: after } = await owner.client
    .from('daily_reports')
    .select('activities')
    .eq('id', report1Id)
    .single()

  if (!before || !after || before.activities !== after.activities) {
    record(name, false, 'BREACH: the owner changed a submitted report.')
  } else if (error) {
    record(name, true, `Server refused: ${error.message}`)
  } else if (data.length === 0) {
    record(name, true, 'Server changed nothing.')
  } else {
    record(name, false, 'Update reported success.')
  }
}

{
  const name = "Owner reopens site manager 1's report"
  const { data, error } = await owner.client
    .from('daily_reports')
    .update({ status: 'draft', reopen_reason: 'RLS attack test: reopen check' })
    .eq('id', report1Id)
    .select('status, reopened_at, reopened_by')
  if (error) {
    record(name, false, `Error: ${error.message}`)
  } else if (
    data.length !== 1 ||
    data[0].status !== 'draft' ||
    !data[0].reopened_at ||
    data[0].reopened_by !== owner.userId
  ) {
    record(name, false, 'The report was not reopened properly.')
  } else {
    record(name, true, 'Back to draft; the database recorded who reopened it and when.')
  }
}

for (const table of [
  'projects',
  'employees',
  'equipment',
  'daily_reports',
  'report_crew',
  'report_equipment',
]) {
  const name = `Site manager reads ${table} (allowed, no money fields)`
  const { data, error } = await site.client.from(table).select('*')
  if (error) {
    record(name, false, `Could not read ${table}: ${error.message}`)
  } else if (data.length === 0) {
    record(name, false, `Inconclusive: zero ${table} came back, so the columns couldn't be checked.`)
  } else {
    const unexpected = [
      ...new Set(data.flatMap((row) => Object.keys(row))),
    ].filter((column) => !ALLOWED_COLUMNS[table].includes(column))
    if (unexpected.length > 0) {
      record(name, false, `Unapproved column(s) sent to a site manager: ${unexpected.join(', ')}.`)
    } else {
      record(name, true, `${data.length} row(s), only approved columns.`)
    }
  }
}

await site.client.auth.signOut()

// =============================================================================
// Owner checks - proves the protected data really exists and works
// =============================================================================
console.log('\nChecking as the owner…\n')

{
  const name = 'Owner reads owner_only_test (control)'
  const { data, error } = await owner.client.from('owner_only_test').select('id')
  if (error) {
    record(name, false, `Error: ${error.message}`)
  } else if (data.length === 0) {
    record(name, false, 'Owner saw zero rows, so the site manager check proves nothing.')
  } else {
    record(name, true, `Owner can see ${data.length} row(s).`)
  }
}

for (const { date, expected } of [
  { date: '2026-03-15', expected: 100 },
  { date: '2026-07-01', expected: 120 },
  { date: '2025-12-31', expected: null },
]) {
  const name = `Owner: rate_on(test employee, ${date}) = ${expected ?? 'nothing'}`
  const { data, error } = await owner.client.rpc('rate_on', {
    p_employee_id: testEmployeeId,
    p_date: date,
  })
  const actual = data === null ? null : Number(data)
  if (error) {
    record(name, false, `Error: ${error.message}`)
  } else if (actual !== expected) {
    record(name, false, `Got ${actual ?? 'nothing'}.`)
  } else {
    record(name, true, `Got ${actual ?? 'nothing'}.`)
  }
}

await owner.client.auth.signOut()

// --- Summary --------------------------------------------------------------------
const failed = results.filter((passed) => !passed).length
console.log(
  failed === 0
    ? `\nALL ${results.length} CHECKS PASSED - the Rate Wall held.\n`
    : `\n${failed} of ${results.length} CHECKS FAILED - the Rate Wall has a problem.\n`,
)
process.exitCode = failed === 0 ? 0 : 1
