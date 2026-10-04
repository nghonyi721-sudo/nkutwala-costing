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
//   TEST_SITE_EMAIL, TEST_SITE_PASSWORD, TEST_SITE2_EMAIL, TEST_SITE2_PASSWORD,
//   TEST_OWNER_EMAIL, TEST_OWNER_PASSWORD, TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD
//
// NEVER give this script a service_role / secret key: that key ignores all
// security rules, so every attack would "succeed" and the test would be
// meaningless. The guard below refuses to run with one.
//
// Test data: "ZZ RLS Test Employee" (inactive) and "ZZ RLS Test Project"
// (complete) are created once and reused, because nothing can be deleted.
// Each run adds a few "ZZ RLS Test Vendor" receipts and leaves every one of
// them rejected, reversed or discarded, so none wait in the Pending queue.

import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
// The app's own receipt-sending steps, so the test saves, uploads (to the
// place the database gives) and submits exactly the way the app does.
import { saveDraft, submitDraft, uploadPhoto } from '../src/lib/receiptSteps.js'

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

// Receipts: a tiny real JPEG, and a vendor name that marks test receipts.
const TEST_RECEIPT_PHOTO = readFileSync(
  fileURLToPath(new URL('./fixtures/test-receipt.jpg', import.meta.url)),
)
const TEST_VENDOR_PREFIX = 'ZZ RLS Test Vendor'

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
  // Every column EXCEPT amount. Asking for amount (or "*") must be refused.
  receipts: [
    'id', 'company_id', 'project_id', 'report_id', 'uploader_id', 'receipt_date',
    'vendor', 'vendor_normalised', 'category', 'notes', 'image_path', 'image_hash',
    'status', 'duplicate_checked', 'reviewed_by', 'reviewed_at', 'review_reason',
    'created_at', 'updated_at',
  ],
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
  'TEST_ADMIN_EMAIL',
  'TEST_ADMIN_PASSWORD',
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

// =============================================================================
// Receipts (phase 4)
// =============================================================================
console.log('\nReceipt attacks…\n')

const admin = await signIn(process.env.TEST_ADMIN_EMAIL, process.env.TEST_ADMIN_PASSWORD)
{
  const role = await readOwnRole(admin.client, admin.userId)
  if (role !== 'system_admin') {
    stop(
      `the TEST_ADMIN_EMAIL user's role is "${role ?? 'unreadable'}", not system_admin. ` +
        'Fix the role in the profiles table, then run again.',
    )
  }
}

let companyId
{
  const { data, error } = await site.client
    .from('profiles')
    .select('company_id')
    .eq('id', site.userId)
    .single()
  if (error) stop(`site manager 1 could not read their own company: ${error.message}`)
  companyId = data.company_id
}

// This run's own vendors, amounts and photos, so nothing can match a receipt
// from an earlier run.
const RUN_TAG = randomUUID().slice(0, 8)
const runCents = parseInt(RUN_TAG.slice(0, 4), 16) // 0 - 65535
const AMOUNT_1 = Number((1000 + runCents / 100).toFixed(2))
const AMOUNT_2 = Number((AMOUNT_1 + 111.11).toFixed(2))
const AMOUNT_5 = Number((AMOUNT_1 + 222.22).toFixed(2))
const AMOUNT_ADMIN = Number((AMOUNT_1 + 333.33).toFixed(2))
const VENDOR_1 = `${TEST_VENDOR_PREFIX} ${RUN_TAG} One`
// The same vendor typed differently: other case, extra punctuation.
const VENDOR_1_RETYPED = `${TEST_VENDOR_PREFIX} ${RUN_TAG.toUpperCase()}-one.`
const VENDOR_2 = `${TEST_VENDOR_PREFIX} ${RUN_TAG} Two`
const VENDOR_5 = `${TEST_VENDOR_PREFIX} ${RUN_TAG} Five`
const VENDOR_ADMIN = `${TEST_VENDOR_PREFIX} ${RUN_TAG} Admin`

// The same small picture with a different tail, so each is a "different photo".
const testPhoto = (tag) => Buffer.concat([TEST_RECEIPT_PHOTO, Buffer.from(`${RUN_TAG}-${tag}`)])
const PHOTO_A = testPhoto('A')
const PHOTO_C = testPhoto('C')
const PHOTO_ADMIN = testPhoto('admin')
const PHOTO_REPLACEMENT = testPhoto('replacement')

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

// Today in South Africa, as "YYYY-MM-DD", and days either side of it.
const saToday = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' })
function shiftDate(isoDate, days) {
  const date = new Date(`${isoDate}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

// The values the app sends for a new receipt (the phone picks the id).
function receiptValues({ vendor, amount, photo, date = saToday }) {
  return {
    id: randomUUID(),
    project_id: testProjectId,
    receipt_date: date,
    vendor,
    category: 'other',
    amount,
    notes: `RLS attack test ${RUN_TAG}`,
    image_hash: photo ? sha256(photo) : null,
  }
}

// Saves a draft with the app's own step. The photo's place (path) comes from
// the database, exactly as in the app - the test never builds it itself.
async function createTestReceipt(who, label, details) {
  const values = receiptValues(details)
  try {
    const saved = await saveDraft(who.client, values)
    return { id: values.id, path: saved.image_path, photo: details.photo }
  } catch (error) {
    stop(`${label} could not save a draft receipt: ${error.message}`)
  }
}

async function uploadTestPhoto(who, label, receipt) {
  try {
    await uploadPhoto(who.client, receipt.path, receipt.photo)
  } catch (error) {
    stop(`${label} could not upload a receipt photo: ${error.message}`)
  }
}

function changeReceipt(who, receiptId, changes) {
  return who.client.from('receipts').update(changes).eq('id', receiptId).select('id, status')
}

async function submitTestReceipt(who, label, receiptId) {
  try {
    await submitDraft(who.client, receiptId)
  } catch (error) {
    stop(`${label} could not submit a test receipt: ${error.message}`)
  }
}

// What the owner sees - used to confirm an attack really changed nothing.
async function readStatus(receiptId) {
  const { data } = await owner.client.from('receipts').select('status').eq('id', receiptId).maybeSingle()
  return data?.status ?? null
}
async function readVendor(receiptId) {
  const { data } = await owner.client.from('receipts').select('vendor').eq('id', receiptId).maybeSingle()
  return data?.vendor ?? null
}
async function readAmount(receiptId) {
  const { data } = await owner.client
    .from('receipt_amounts')
    .select('amount')
    .eq('receipt_id', receiptId)
    .maybeSingle()
  return data ? Number(data.amount) : null
}
async function storedPhotoHash(path) {
  const { data, error } = await owner.client.storage.from('receipts').download(path)
  if (error) return null
  return sha256(Buffer.from(await data.arrayBuffer()))
}

// A receipt change that must NOT happen. "Refused" (with the expected error
// code, if one is given) and "changed nothing" both pass - then the owner
// re-reads the receipt to make sure it really didn't change.
async function attackReceipt(name, who, receiptId, changes, { read, expectedCode }) {
  const before = await read(receiptId)
  const { data, error } = await who.client
    .from('receipts')
    .update(changes)
    .eq('id', receiptId)
    .select('id')
  const after = await read(receiptId)

  if (before === null) {
    record(name, false, 'Inconclusive: the owner could not read the receipt first.')
  } else if (before !== after) {
    record(name, false, `BREACH: changed from "${before}" to "${after}".`)
  } else if (error && expectedCode && error.code !== expectedCode) {
    record(name, false, `Refused for the wrong reason (${error.code}): ${error.message}`)
  } else if (error) {
    record(name, true, `Server refused: ${error.message}`)
  } else if (data.length === 0) {
    record(name, true, 'Server changed nothing; owner confirms no change.')
  } else {
    record(name, false, 'Update reported success.')
  }
}

// Test receipts left behind by an interrupted run are finished off first, so
// nothing sits in the Pending queue. The same tidy-up runs at the end.
async function finishLeftoverTestReceipts() {
  for (const who of [site, site2, admin]) {
    await who.client
      .from('receipts')
      .update({ status: 'discarded' })
      .like('vendor', `${TEST_VENDOR_PREFIX}%`)
      .eq('uploader_id', who.userId)
      .eq('status', 'draft')
  }
  await owner.client
    .from('receipts')
    .update({ status: 'rejected', review_reason: 'RLS attack test: tidy-up' })
    .like('vendor', `${TEST_VENDOR_PREFIX}%`)
    .eq('status', 'submitted')
  await admin.client
    .from('receipts')
    .update({ status: 'reversed', review_reason: 'RLS attack test: tidy-up' })
    .like('vendor', `${TEST_VENDOR_PREFIX}%`)
    .eq('status', 'approved')
}

await finishLeftoverTestReceipts()

// --- Site manager 1: creating receipts ---------------------------------------
await attackInsert(
  'Site manager 1 adds a receipt as the owner (forged uploader_id)',
  site.client,
  'receipts',
  { ...receiptValues({ vendor: `${TEST_VENDOR_PREFIX} ${RUN_TAG} forged`, amount: 1 }), uploader_id: owner.userId },
)
await attackInsert(
  'Site manager 1 adds a receipt that is already approved',
  site.client,
  'receipts',
  { ...receiptValues({ vendor: `${TEST_VENDOR_PREFIX} ${RUN_TAG} pre-approved`, amount: 1 }), status: 'approved' },
)
await attackInsert(
  'Site manager 1 adds a receipt dated tomorrow',
  site.client,
  'receipts',
  receiptValues({ vendor: `${TEST_VENDOR_PREFIX} ${RUN_TAG} future`, amount: 1, date: shiftDate(saToday, 1) }),
  '23514',
  'Refused: future dates are blocked (South African time).',
)

const receipt1 = await createTestReceipt(site, 'site manager 1', {
  vendor: VENDOR_1,
  amount: AMOUNT_1,
  photo: PHOTO_A,
})

{
  const name = "Site manager 1 uploads a photo into site manager 2's folder"
  const { error } = await site.client.storage
    .from('receipts')
    .upload(`${companyId}/${site2.userId}/${receipt1.id}.jpg`, PHOTO_A, { contentType: 'image/jpeg' })
  if (error) {
    record(name, true, `Server refused: ${error.message}`)
  } else {
    record(name, false, "BREACH: a photo was stored in another person's folder.")
  }
}

await uploadTestPhoto(site, 'site manager 1', receipt1)
{
  const ownFolder = `${companyId}/${site.userId}/`
  record(
    "Site manager 1 saves a draft and uploads its photo with the app's own steps",
    receipt1.path === `${ownFolder}${receipt1.id}.jpg`,
    `Uploaded to the place the database gave: ${receipt1.path} (their own folder).`,
  )
}

await attackReceipt(
  'Site manager 1 approves their own draft directly (draft → approved)',
  site,
  receipt1.id,
  { status: 'approved' },
  { read: readStatus, expectedCode: PERMISSION_DENIED },
)

{
  const name = "Site manager 1 submits with the app's own step (save → upload → submit)"
  let problem = null
  try {
    await submitDraft(site.client, receipt1.id)
    if ((await readStatus(receipt1.id)) !== 'submitted') problem = 'the receipt is not marked submitted'
  } catch (error) {
    problem = error.message
  }
  if (problem) {
    record(name, false, `Could not submit: ${problem}`)
    stop('the remaining receipt checks need a submitted receipt.')
  }
  record(name, true, 'Submitted - the database found the uploaded photo before accepting it.')
}

// --- Site manager 1: after submitting -----------------------------------------
await attackReceipt(
  'Site manager 1 changes the amount after submitting',
  site,
  receipt1.id,
  { amount: 1 },
  { read: readAmount },
)
await attackReceipt(
  'Site manager 1 approves their own submitted receipt',
  site,
  receipt1.id,
  { status: 'approved' },
  { read: readStatus },
)
await attackDelete('Site manager 1 deletes their receipt', site.client, 'receipts', receipt1.id)

{
  const name = "Site manager 1 replaces their submitted receipt's photo"
  const { error } = await site.client.storage
    .from('receipts')
    .upload(receipt1.path, PHOTO_REPLACEMENT, { contentType: 'image/jpeg', upsert: true })
  const stored = await storedPhotoHash(receipt1.path)
  if (stored !== sha256(PHOTO_A)) {
    record(name, false, 'BREACH: the stored photo changed (or the owner could not open it).')
  } else if (error) {
    record(name, true, 'Server refused; owner confirms the photo is unchanged.')
  } else {
    record(name, false, 'Upload reported success.')
  }
}

{
  const name = "Site manager 1 deletes their receipt's photo"
  const { data, error } = await site.client.storage.from('receipts').remove([receipt1.path])
  const stored = await storedPhotoHash(receipt1.path)
  if (stored !== sha256(PHOTO_A)) {
    record(name, false, 'BREACH: the photo is gone or changed.')
  } else if (error || data.length === 0) {
    record(name, true, 'Nothing was deleted; owner confirms the photo is still there.')
  } else {
    record(name, false, 'Delete reported success.')
  }
}

// --- The Rate Wall on receipts --------------------------------------------------
for (const { name, query } of [
  {
    name: 'Site manager 1 reads the amount of their own receipt',
    query: () => site.client.from('receipts').select('id, amount').eq('id', receipt1.id),
  },
  {
    name: 'Site manager 1 reads every column of their receipts (select *)',
    query: () => site.client.from('receipts').select('*'),
  },
  {
    name: 'Site manager 1 filters their receipts by amount',
    query: () => site.client.from('receipts').select('id').gt('amount', 0),
  },
]) {
  const { data, error } = await query()
  if (error?.code === PERMISSION_DENIED) {
    record(name, true, 'Server refused: the amount column is walled off.')
  } else if (error) {
    record(name, false, `Unexpected error: ${error.message}`)
  } else {
    record(name, false, `LEAK: the server answered with ${data.length} row(s).`)
  }
}

await attackReadNothing('Site manager 1 reads receipt_amounts', site.client, 'receipt_amounts')
await attackInsert('Site manager 1 writes to the receipt status log', site.client, 'receipt_status_log', {
  receipt_id: receipt1.id,
  from_status: 'submitted',
  to_status: 'approved',
})

{
  const name = 'Site manager 1 reads their own receipts (allowed, no amounts)'
  const { data, error } = await site.client
    .from('receipts')
    .select(ALLOWED_COLUMNS.receipts.join(', '))
  if (error) {
    record(name, false, `Could not read: ${error.message}`)
  } else if (!data.some((row) => row.id === receipt1.id)) {
    record(name, false, 'Their own receipt was missing.')
  } else if (data.some((row) => row.uploader_id !== site.userId)) {
    record(name, false, "LEAK: other people's receipts came back.")
  } else {
    record(name, true, `${data.length} receipt(s), all their own, without amounts.`)
  }
}

{
  const name = "Site manager 1 reads their receipt's status log (allowed)"
  const { data, error } = await site.client
    .from('receipt_status_log')
    .select('from_status, to_status, changed_by')
    .eq('receipt_id', receipt1.id)
  const steps = (data ?? []).map((row) => `${row.from_status ?? 'new'} → ${row.to_status}`)
  if (error) {
    record(name, false, `Could not read: ${error.message}`)
  } else if (!steps.includes('new → draft') || !steps.includes('draft → submitted')) {
    record(name, false, `The log is incomplete: ${steps.join(', ') || 'empty'}.`)
  } else {
    record(name, true, `Logged automatically: ${steps.join(', ')}.`)
  }
}

// --- Duplicate detection ------------------------------------------------------
const receipt2 = await createTestReceipt(site, 'site manager 1', {
  vendor: VENDOR_2,
  amount: AMOUNT_2,
  photo: PHOTO_A, // the same photo as receipt 1
})
await uploadTestPhoto(site, 'site manager 1', receipt2)

{
  const name = 'Duplicate check: the same photo uploaded twice'
  const { data, error } = await site.client.rpc('receipt_duplicates', { p_receipt_id: receipt2.id })
  const match = data?.find((row) => row.receipt_id === receipt1.id)
  if (error) {
    record(name, false, `Error: ${error.message}`)
  } else if (data.some((row) => 'amount' in row)) {
    record(name, false, 'LEAK: the duplicate check sent amounts to a site manager.')
  } else if (!match?.same_photo) {
    record(name, false, 'The second receipt was NOT flagged.')
  } else {
    record(name, true, 'The second receipt is flagged as the same photo (no amounts in the answer).')
  }
}

await submitTestReceipt(site, 'site manager 1', receipt2.id)

const receipt3 = await createTestReceipt(site, 'site manager 1', {
  vendor: VENDOR_1_RETYPED,
  amount: AMOUNT_1,
  photo: PHOTO_C,
  date: shiftDate(saToday, -1),
})

{
  const name = 'Duplicate check: same vendor (typed differently), amount and date (a day apart)'
  const { data, error } = await site.client.rpc('receipt_duplicates', { p_receipt_id: receipt3.id })
  const match = data?.find((row) => row.receipt_id === receipt1.id)
  if (error) {
    record(name, false, `Error: ${error.message}`)
  } else if (!match?.same_details) {
    record(name, false, 'It was NOT flagged.')
  } else {
    record(name, true, `Flagged: "${VENDOR_1_RETYPED}" matched "${VENDOR_1}".`)
  }
}

// Receipt 3's photo was never uploaded, so the database must refuse it.
await attackReceipt(
  'Site manager 1 submits a receipt whose photo was never uploaded',
  site,
  receipt3.id,
  { status: 'submitted' },
  { read: readStatus, expectedCode: '23514' },
)

// --- Site manager 2 -------------------------------------------------------------
{
  const name = "Site manager 2 reads site manager 1's receipts"
  const { data, error } = await site2.client
    .from('receipts')
    .select('id')
    .in('id', [receipt1.id, receipt2.id, receipt3.id])
  if (error && error.code !== PERMISSION_DENIED) {
    record(name, false, `Unexpected error: ${error.message}`)
  } else if ((data?.length ?? 0) > 0) {
    record(name, false, `LEAK: ${data.length} of site manager 1's receipts came back.`)
  } else {
    record(name, true, 'Zero rows came back.')
  }
}

{
  const name = "Site manager 2 opens site manager 1's receipt photo"
  const download = await site2.client.storage.from('receipts').download(receipt1.path)
  const link = await site2.client.storage.from('receipts').createSignedUrl(receipt1.path, 60)
  if (!download.error) {
    record(name, false, 'LEAK: the photo was downloaded.')
  } else if (!link.error) {
    record(name, false, 'LEAK: a link to the photo was made.')
  } else {
    record(name, true, 'Download and photo link both refused.')
  }
}

{
  const name = "Site manager 2 reads the status log of site manager 1's receipt"
  const { data, error } = await site2.client
    .from('receipt_status_log')
    .select('id')
    .eq('receipt_id', receipt1.id)
  if (error && error.code !== PERMISSION_DENIED) {
    record(name, false, `Unexpected error: ${error.message}`)
  } else if ((data?.length ?? 0) > 0) {
    record(name, false, `LEAK: ${data.length} log row(s) came back.`)
  } else {
    record(name, true, 'Zero rows came back.')
  }
}

{
  const name = "Site manager 2 runs the duplicate check on site manager 1's receipt"
  const { data, error } = await site2.client.rpc('receipt_duplicates', { p_receipt_id: receipt1.id })
  if (error) {
    record(name, false, `Unexpected error: ${error.message}`)
  } else if (data.length > 0) {
    record(name, false, `LEAK: ${data.length} match(es) came back.`)
  } else {
    record(name, true, 'Zero rows came back.')
  }
}

await attackReceipt(
  "Site manager 2 discards site manager 1's draft",
  site2,
  receipt3.id,
  { status: 'discarded' },
  { read: readStatus },
)

{
  const receipt5 = await createTestReceipt(site2, 'site manager 2', {
    vendor: VENDOR_5,
    amount: AMOUNT_5,
    photo: PHOTO_A, // the same photo site manager 1 used
  })

  const name = "Site manager 2's duplicate check never shows site manager 1's receipts"
  const [theirs, owners] = await Promise.all([
    site2.client.rpc('receipt_duplicates', { p_receipt_id: receipt5.id }),
    owner.client.rpc('receipt_duplicates', { p_receipt_id: receipt5.id }),
  ])
  if (theirs.error || owners.error) {
    record(name, false, `Error: ${(theirs.error ?? owners.error).message}`)
  } else if (theirs.data.length > 0) {
    record(name, false, `LEAK: ${theirs.data.length} match(es) from someone else came back.`)
  } else if (!owners.data.some((row) => row.receipt_id === receipt1.id)) {
    record(name, false, "Inconclusive: the owner's check didn't flag the same photo either.")
  } else {
    record(name, true, "Zero matches for site manager 2; the owner's check does flag the same photo.")
  }

  const { data, error } = await changeReceipt(site2, receipt5.id, { status: 'discarded' })
  record(
    'Site manager 2 discards their own draft',
    !error && data.length === 1 && data[0].status === 'discarded',
    error ? `Error: ${error.message}` : 'Discarded - kept for the record, never counted.',
  )
}

// --- Owner ----------------------------------------------------------------------
{
  const name = 'Owner reads amounts through receipt_amounts (control)'
  const amount = await readAmount(receipt1.id)
  if (amount === AMOUNT_1) {
    record(name, true, `Owner sees R ${amount.toFixed(2)}.`)
  } else {
    record(name, false, `Expected ${AMOUNT_1}, got ${amount ?? 'nothing'}.`)
  }
}

await attackReceipt(
  'Owner approves a possible duplicate without ticking "checked"',
  owner,
  receipt2.id,
  { status: 'approved' },
  { read: readStatus, expectedCode: '23514' },
)
await attackReceipt(
  'Owner edits the vendor of a submitted receipt',
  owner,
  receipt2.id,
  { vendor: 'OWNER EDIT' },
  { read: readVendor, expectedCode: PERMISSION_DENIED },
)
await attackReceipt(
  'Owner changes the amount of a submitted receipt',
  owner,
  receipt2.id,
  { amount: 1 },
  { read: readAmount, expectedCode: PERMISSION_DENIED },
)

{
  const name = "Owner approves site manager 1's receipt"
  const { error } = await changeReceipt(owner, receipt1.id, { status: 'approved', duplicate_checked: true })
  const { data: receipt } = await owner.client
    .from('receipts')
    .select('status, reviewed_by')
    .eq('id', receipt1.id)
    .single()
  const { data: log } = await owner.client
    .from('receipt_status_log')
    .select('changed_by')
    .eq('receipt_id', receipt1.id)
    .eq('to_status', 'approved')
  if (error) {
    record(name, false, `Error: ${error.message}`)
  } else if (receipt?.status !== 'approved' || receipt.reviewed_by !== owner.userId) {
    record(name, false, 'The receipt was not approved properly.')
  } else if (!log?.some((row) => row.changed_by === owner.userId)) {
    record(name, false, 'Approved, but no status log row was written.')
  } else {
    record(name, true, 'Approved after ticking "checked"; the status log recorded who and when.')
  }
}

await attackReceipt(
  'Owner reverses an approved receipt',
  owner,
  receipt1.id,
  { status: 'reversed', review_reason: 'RLS attack test' },
  { read: readStatus, expectedCode: PERMISSION_DENIED },
)
await attackReceipt(
  'Owner rejects a receipt without a reason',
  owner,
  receipt2.id,
  { status: 'rejected' },
  { read: readStatus, expectedCode: '23514' },
)

{
  const name = 'Owner rejects a receipt with a reason'
  const { data, error } = await changeReceipt(owner, receipt2.id, {
    status: 'rejected',
    review_reason: 'RLS attack test: duplicate photo',
  })
  if (error || data.length !== 1 || data[0].status !== 'rejected') {
    record(name, false, `Could not reject: ${error?.message ?? 'no row updated'}`)
  } else {
    record(name, true, 'Rejected; the reason is kept.')
  }
}

await attackReceipt(
  'Owner puts a rejected receipt back to submitted',
  owner,
  receipt2.id,
  { status: 'submitted' },
  { read: readStatus },
)

// --- System admin ---------------------------------------------------------------
{
  const adminReceipt = await createTestReceipt(admin, 'system admin', {
    vendor: VENDOR_ADMIN,
    amount: AMOUNT_ADMIN,
    photo: PHOTO_ADMIN,
  })
  await uploadTestPhoto(admin, 'system admin', adminReceipt)
  await submitTestReceipt(admin, 'system admin', adminReceipt.id)

  await attackReceipt(
    'System admin approves a receipt they took themselves',
    admin,
    adminReceipt.id,
    { status: 'approved' },
    { read: readStatus, expectedCode: PERMISSION_DENIED },
  )

  // Finish it: the owner rejects it, so it doesn't wait in Pending.
  const { error } = await changeReceipt(owner, adminReceipt.id, {
    status: 'rejected',
    review_reason: 'RLS attack test: tidy-up',
  })
  if (error) console.log(`          (note: could not tidy up the admin's test receipt: ${error.message})`)
}

await attackReceipt(
  'System admin reverses an approved receipt without a reason',
  admin,
  receipt1.id,
  { status: 'reversed' },
  { read: readStatus, expectedCode: '23514' },
)

{
  const name = 'System admin reverses an approved receipt with a reason'
  const { data, error } = await changeReceipt(admin, receipt1.id, {
    status: 'reversed',
    review_reason: 'RLS attack test: reversal check',
  })
  const { data: log } = await owner.client
    .from('receipt_status_log')
    .select('changed_by, reason')
    .eq('receipt_id', receipt1.id)
    .eq('to_status', 'reversed')
  if (error || data.length !== 1 || data[0].status !== 'reversed') {
    record(name, false, `Could not reverse: ${error?.message ?? 'no row updated'}`)
  } else if (!log?.some((row) => row.changed_by === admin.userId && row.reason)) {
    record(name, false, 'Reversed, but the status log has no row with who and why.')
  } else {
    record(name, true, 'Reversed; the status log recorded who, when and why.')
  }
}

{
  const { data, error } = await changeReceipt(site, receipt3.id, { status: 'discarded' })
  record(
    'Site manager 1 discards their own draft',
    !error && data.length === 1 && data[0].status === 'discarded',
    error ? `Error: ${error.message}` : 'Discarded - kept for the record, never counted.',
  )
}

await finishLeftoverTestReceipts()
await site2.client.auth.signOut()
await admin.client.auth.signOut()

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
