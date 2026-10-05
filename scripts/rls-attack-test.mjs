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
// For costing, each run creates its own "ZZ Costing Test <run>" project and
// inactive "ZZ Costing" people and machines, and marks the project complete.
// For new employees and project teams, each run creates its own "ZZ Pending
// Test <run>" project and "ZZ Pending" people (added by site manager 1 the
// app's way); at the end the people are inactive and the project complete.

import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
// The app's own receipt-sending steps, so the test saves, uploads (to the
// place the database gives) and submits exactly the way the app does.
import { saveDraft, submitDraft, uploadPhoto } from '../src/lib/receiptSteps.js'
// The app's one category list, checked against the database's.
import { COST_CATEGORY_LABELS } from '../src/lib/labels.js'
// The app's own steps for adding people, project teams and approval.
import {
  addEmployee,
  approveEmployee,
  assignToProject,
  fetchTeam,
  findDuplicates,
  rejectEmployee,
  removeFromProject,
  updateEmployeeDetails,
} from '../src/lib/employeeSteps.js'
// The app's own export code (the same Excel files the app saves).
import { buildProjectCost, fetchProjectCost } from '../src/lib/exports/projectCost.js'
import { buildPayrollHours, fetchPayrollHours } from '../src/lib/exports/payrollHours.js'
import { ALLOCATION_TITLE, PAY_ONLY_UNFILTERED, PAY_TITLE, exportLogFilters } from '../src/lib/exports/workbook.js'

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
  employees: [
    'id', 'company_id', 'full_name', 'category', 'active', 'created_at', 'phone', 'status',
    'created_by', 'approved_at', 'approved_by', 'rejected_at', 'rejected_by', 'reject_reason',
  ],
  project_employees: ['id', 'company_id', 'project_id', 'employee_id', 'assigned_by', 'assigned_at', 'active'],
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
const checkNames = []

function record(name, passed, detail) {
  results.push(passed)
  checkNames.push(name)
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

// A new test person, added the app's way (everyone starts as Pending). Then
// the owner either approves them with a rate ({ rate }) or rejects them
// ({ reject: true }); either way they end up inactive, so they never show in
// anyone's pick lists. Returns their id.
async function createTestPerson(name, { rate, reject = false }) {
  try {
    const person = await addEmployee(owner.client, { fullName: name, category: 'general_worker' })
    if (reject) {
      await rejectEmployee(owner.client, person.id, 'RLS test person')
      return person.id
    }
    await approveEmployee(owner.client, person.id, rate.hourly_rate, rate.effective_from)
    const { error } = await owner.client.from('employees').update({ status: 'inactive' }).eq('id', person.id)
    if (error) throw error
    return person.id
  } catch (error) {
    stop(`owner setup: could not create test person ${name}: ${error.message}`)
  }
}

// The reused test people: found by name, or created once.
async function findOrCreatePerson(name, how) {
  const { data, error } = await owner.client.from('employees').select('id').eq('full_name', name).limit(1)
  if (error) stop(`owner setup: could not read employees: ${error.message}`)
  return data.length > 0 ? data[0].id : createTestPerson(name, how)
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
// can't be mistaken for a pass. keyColumn: the table's key, asked for back
// (most tables use "id").
async function attackInsert(
  name,
  client,
  table,
  values,
  expectedCode = PERMISSION_DENIED,
  refusedBecause = 'Server refused.',
  keyColumn = 'id',
) {
  const { data, error } = await client.from(table).insert(values).select(keyColumn)
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

const testEmployeeId = await findOrCreatePerson(TEST_EMPLOYEE_NAME, { rate: TEST_RATES[0] })
const testProjectId = await findOrCreate(owner.client, 'projects', 'name', {
  name: TEST_PROJECT_NAME,
  status: 'complete',
})
const testEmployee2Id = await findOrCreatePerson(TEST_EMPLOYEE_2_NAME, { reject: true })
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
// Site managers may add people, but only as Pending: the app can't send a
// status (or who added them) at all.
await attackInsert('Site manager adds an employee as Approved', site.client, 'employees', {
  full_name: 'ZZ attack employee',
  category: 'general_worker',
  status: 'approved',
})
await attackInsert('Site manager adds an employee, claiming someone else added them', site.client, 'employees', {
  full_name: 'ZZ attack employee',
  category: 'general_worker',
  created_by: owner.userId,
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

// =============================================================================
// Budgets and costing (phase 5)
// =============================================================================
// Each run uses its OWN project, people and machines ("ZZ Costing … <run>"),
// so every total is exact. Nothing can be deleted, so afterwards the test
// finishes everything off: project complete, receipts rejected/reversed,
// people and machines created inactive.
console.log('\nBudgets and costing attacks…\n')

// Which checks attack which object - reported at the end of this section.
const coverage = new Map()
function covers(...objects) {
  for (const object of objects) {
    coverage.set(object, [...(coverage.get(object) ?? []), results.length])
  }
}

const COST_DAY_1 = '2026-03-02' // a Monday
const COST_DAY_2 = '2026-03-03'
const COST_DAY_3 = '2026-03-04'
const COST_PREFIX = 'ZZ Costing Test'

async function ownerInsert(table, values, label) {
  const { data, error } = await owner.client.from(table).insert(values).select('id').single()
  if (error) stop(`owner setup: could not create ${label}: ${error.message}`)
  return data.id
}

// Finish off a costing project left active by an interrupted run.
{
  const { error } = await owner.client
    .from('projects')
    .update({ status: 'complete' })
    .like('name', `${COST_PREFIX}%`)
    .eq('status', 'active')
  if (error) stop(`owner could not tidy up old costing test projects: ${error.message}`)
}

const costProjectId = await ownerInsert('projects', { name: `${COST_PREFIX} ${RUN_TAG}`, status: 'active' }, 'the costing test project')
// Approved at R100 from 1 Jan 2026, then made inactive.
const ratedEmployeeId = await createTestPerson(`ZZ Costing Rated ${RUN_TAG}`, {
  rate: { hourly_rate: 100, effective_from: '2026-01-01' },
})
// Approved too (nobody is approved without a rate), but their rate only
// starts long after the test days - so those days have NO rate.
const unratedEmployeeId = await createTestPerson(`ZZ Costing Unrated ${RUN_TAG}`, {
  rate: { hourly_rate: 100, effective_from: '2099-01-01' },
})
const ownedPlantId = await ownerInsert(
  'equipment',
  { name: `ZZ Costing Owned Plant ${RUN_TAG}`, ownership: 'own', active: false },
  'the owned test plant',
)
const rentedPlantId = await ownerInsert(
  'equipment',
  { name: `ZZ Costing Rented Plant ${RUN_TAG}`, ownership: 'rented', active: false },
  'the rented test plant',
)

{
  const { error } = await owner.client
    .from('equipment_rates')
    .insert({ equipment_id: ownedPlantId, hourly_rate: 250, effective_from: '2026-01-01' })
  record(
    'Owner adds a rate for owned equipment (R250/h)',
    !error,
    error ? `Could not add it: ${error.message}` : 'Added.',
  )
  covers('equipment_rates', 'equipment_rates_before_insert')
  if (error) stop('the costing checks need the owned-plant rate.')
}

await attackInsert(
  'Owner adds a rate for RENTED equipment',
  owner.client,
  'equipment_rates',
  { equipment_id: rentedPlantId, hourly_rate: 300, effective_from: '2026-01-01' },
  '23514',
  'Refused: rented equipment is costed from its hire receipts, not a rate.',
)
covers('equipment_rates', 'equipment_rates_before_insert')

// --- Site manager 1 fills in the reports, the app's way -----------------------
async function saveCostReport(date, crew, equipment) {
  const { data, error } = await site.client.rpc('save_report_draft', {
    p_report: { project_id: costProjectId, report_date: date, fuel_litres: 40, activities: `RLS costing test ${RUN_TAG}` },
    p_crew: crew,
    p_equipment: equipment,
  })
  if (error) stop(`site manager 1 could not save a costing test report: ${error.message}`)
  return data
}
async function submitCostReport(reportId) {
  const { data, error } = await site.client
    .from('daily_reports')
    .update({ status: 'submitted' })
    .eq('id', reportId)
    .select('status')
  if (error || data.length !== 1) stop(`site manager 1 could not submit a costing test report: ${error?.message}`)
}

// Report A: 10 rated crew hours, 4 owned-plant hours, 5 RENTED hours, 40 litres
// of fuel. Submitted.
const reportA = await saveCostReport(
  COST_DAY_1,
  [{ employee_id: ratedEmployeeId, hours: 10 }],
  [
    { equipment_id: ownedPlantId, hours: 4 },
    { equipment_id: rentedPlantId, hours: 5 },
  ],
)
await submitCostReport(reportA)
// Report B: 3 rated hours, left as a DRAFT - must not count.
await saveCostReport(COST_DAY_2, [{ employee_id: ratedEmployeeId, hours: 3 }], [])
// Report C: 2 hours for the person with NO rate. Saved now, submitted later.
const reportC = await saveCostReport(COST_DAY_3, [{ employee_id: unratedEmployeeId, hours: 2 }], [])
record(
  'Site manager saves daily reports with save_report_draft (report, crew, equipment)',
  Boolean(reportA && reportC),
  'Three reports saved, each in one all-or-nothing step.',
)
covers('save_report_draft')

// Receipts, with the app's own steps: R500 fuel (approved), R300 materials
// (submitted, NOT approved), R200 food (rejected).
async function costReceipt(category, amount, tag) {
  const photo = testPhoto(`cost-${tag}`)
  const values = {
    id: randomUUID(),
    project_id: costProjectId,
    receipt_date: saToday,
    vendor: `${TEST_VENDOR_PREFIX} ${RUN_TAG} costing ${tag}`,
    category,
    amount,
    notes: `RLS costing test ${RUN_TAG}`,
    image_hash: sha256(photo),
  }
  try {
    const saved = await saveDraft(site.client, values)
    await uploadPhoto(site.client, saved.image_path, photo)
    await submitDraft(site.client, values.id)
  } catch (error) {
    stop(`site manager 1 could not send a costing test receipt: ${error.message}`)
  }
  return values.id
}
const fuelReceiptId = await costReceipt('fuel', 500, 'fuel')
const materialsReceiptId = await costReceipt('materials', 300, 'materials')
const foodReceiptId = await costReceipt('food', 200, 'food')
for (const [id, changes] of [
  [fuelReceiptId, { status: 'approved', duplicate_checked: true }],
  [foodReceiptId, { status: 'rejected', review_reason: 'RLS costing test: rejected on purpose' }],
]) {
  const { error } = await changeReceipt(owner, id, changes)
  if (error) stop(`owner could not set up a costing test receipt: ${error.message}`)
}

// --- Owner: the totals --------------------------------------------------------
async function projectCosts() {
  const { data, error } = await owner.client
    .from('project_cost_vs_budget')
    .select('category, budget, spent, remaining, percent_used, unpriced_hours')
    .eq('project_id', costProjectId)
  if (error) return { error }
  const byCategory = Object.fromEntries(data.map((row) => [row.category, row]))
  const total = data.reduce((sum, row) => sum + Number(row.spent), 0)
  const unpriced = data.reduce((sum, row) => sum + Number(row.unpriced_hours), 0)
  return { rows: data, byCategory, total, unpriced }
}
const rand = (value) => `R${Number(value).toFixed(2)}`

{
  const name = 'Owner: project total is exactly R2,600 (labour R1,100 with 2 h overtime)'
  const costs = await projectCosts()
  const spent = (category) => Number(costs.byCategory?.[category]?.spent ?? NaN)
  if (costs.error) {
    record(name, false, `Error: ${costs.error.message}`)
  } else if (
    costs.total !== 2600 ||
    spent('labour') !== 1100 ||
    spent('owned_plant') !== 1000 ||
    spent('fuel') !== 500 ||
    spent('materials') !== 0 ||
    spent('food') !== 0 ||
    spent('plant_hire') !== 0
  ) {
    record(
      name,
      false,
      `Got ${rand(costs.total)}: labour ${rand(spent('labour'))}, owned plant ${rand(spent('owned_plant'))}, ` +
        `fuel ${rand(spent('fuel'))}, materials ${rand(spent('materials'))}, food ${rand(spent('food'))}, plant hire ${rand(spent('plant_hire'))}.`,
    )
  } else {
    record(
      name,
      true,
      '10h: 8h x R100 + 2h overtime x R150, + 4h x R250 plant + approved R500 fuel. Not counted: the R300 submitted and R200 rejected receipts, ' +
        '3 hours on a draft report, 5 rented-plant hours, 40 litres of fuel.',
    )
  }
  covers('project_cost_vs_budget', 'project_cost_lines', 'cost_categories', 'rate_on', 'equipment_rate_on')
}

{
  const name = 'Owner: project_cost_lines holds exactly the three priced lines'
  const { data, error } = await owner.client
    .from('project_cost_lines')
    .select('category, hours, unit_rate, amount')
    .eq('project_id', costProjectId)
    .order('category')
  const lines = (data ?? []).map((l) => `${l.category} ${rand(l.amount)}`).join(', ')
  const expected = 'fuel R500.00, labour R1100.00, owned_plant R1000.00'
  if (error) record(name, false, `Error: ${error.message}`)
  else record(name, lines === expected, lines === expected ? lines : `Got: ${lines || 'nothing'}`)
  covers('project_cost_lines')
}

await submitCostReport(reportC)

{
  const name = 'Owner: 2 hours with no rate leave the total at R2,600 and show 2 unpriced hours'
  const costs = await projectCosts()
  const { data: unpriced, error } = await owner.client
    .from('unpriced_hours')
    .select('category, employee_id, report_date, hours')
    .eq('project_id', costProjectId)
  const onlyRow = unpriced?.length === 1 ? unpriced[0] : null
  if (costs.error || error) {
    record(name, false, `Error: ${(costs.error ?? error).message}`)
  } else if (costs.total !== 2600) {
    record(name, false, `The total changed to ${rand(costs.total)}.`)
  } else if (costs.unpriced !== 2 || Number(costs.byCategory.labour.unpriced_hours) !== 2) {
    record(name, false, `Unpriced hours shown: ${costs.unpriced}.`)
  } else if (
    !onlyRow ||
    onlyRow.employee_id !== unratedEmployeeId ||
    onlyRow.report_date !== COST_DAY_3 ||
    Number(onlyRow.hours) !== 2
  ) {
    record(name, false, `The unpriced-hours list is wrong: ${JSON.stringify(unpriced)}`)
  } else {
    record(name, true, 'Total still R2,600; "2 hours unpriced" shown, and listed with the person and date.')
  }
  covers('unpriced_hours', 'project_cost_vs_budget', 'rate_on')
}

{
  const name = 'Owner: cost per week adds up to the same R2,600'
  const { data, error } = await owner.client
    .from('project_cost_by_week')
    .select('week_start, category, amount')
    .eq('project_id', costProjectId)
  const sum = (data ?? []).reduce((total, row) => total + Number(row.amount), 0)
  const firstWeek = (data ?? [])
    .filter((row) => row.week_start === COST_DAY_1)
    .reduce((total, row) => total + Number(row.amount), 0)
  if (error) record(name, false, `Error: ${error.message}`)
  else if (sum !== 2600 || firstWeek !== 2100) record(name, false, `Weeks add up to ${rand(sum)}; week of ${COST_DAY_1}: ${rand(firstWeek)}.`)
  else record(name, true, `Week of ${COST_DAY_1}: R2,100 (labour R1,100 + owned plant R1,000); the fuel receipt in its own week.`)
  covers('project_cost_by_week')
}

{
  const name = 'Owner: vendor spend shows only the approved receipt'
  const { data, error } = await owner.client
    .from('vendor_spend')
    .select('vendor, receipts, amount')
    .eq('project_id', costProjectId)
  if (error) record(name, false, `Error: ${error.message}`)
  else if (data.length !== 1 || Number(data[0].amount) !== 500 || Number(data[0].receipts) !== 1) {
    record(name, false, `Got: ${JSON.stringify(data)}`)
  } else {
    record(name, true, `${data[0].vendor}: 1 receipt, R500 (submitted and rejected ones left out).`)
  }
  covers('vendor_spend')
}

{
  const name = 'Owner: provisional labour per employee per week'
  const { data, error } = await owner.client
    .from('labour_provisional_by_employee_week')
    .select('employee_id, week_start, hours, cost, unpriced_hours, basis, ot_hours, ot_pay')
    .in('employee_id', [ratedEmployeeId, unratedEmployeeId])
  const rated = data?.find((row) => row.employee_id === ratedEmployeeId)
  const unrated = data?.find((row) => row.employee_id === unratedEmployeeId)
  if (error) {
    record(name, false, `Error: ${error.message}`)
  } else if (
    !rated ||
    rated.week_start !== COST_DAY_1 ||
    Number(rated.hours) !== 10 ||
    Number(rated.cost) !== 1100 ||
    Number(rated.ot_hours) !== 2 ||
    Number(rated.ot_pay) !== 300 ||
    !unrated ||
    Number(unrated.cost) !== 0 ||
    Number(unrated.unpriced_hours) !== 2 ||
    !rated.basis.startsWith('PROVISIONAL') ||
    rated.basis.includes('not applied')
  ) {
    record(name, false, `Got: ${JSON.stringify(data)}`)
  } else {
    record(name, true, '10h / R1,100 incl. 2h overtime R300 (the draft report\'s 3h left out); 2h unpriced; labelled PROVISIONAL, overtime included.')
  }
  covers('labour_provisional_by_employee_week', 'rate_on')
}

{
  const name = 'Owner: equipment_rate_on() gives the rate in force on a date'
  const [onDay, before] = await Promise.all([
    owner.client.rpc('equipment_rate_on', { p_equipment_id: ownedPlantId, p_date: COST_DAY_1 }),
    owner.client.rpc('equipment_rate_on', { p_equipment_id: ownedPlantId, p_date: '2025-12-31' }),
  ])
  const error = onDay.error ?? before.error
  if (error) record(name, false, `Error: ${error.message}`)
  else if (Number(onDay.data) !== 250 || before.data !== null) record(name, false, `Got ${onDay.data} and ${before.data}.`)
  else record(name, true, 'R250 on the day; nothing before the rate started.')
  covers('equipment_rate_on')
}

// --- Owner: budgets -----------------------------------------------------------
let budgetId
{
  const name = 'Owner: setting and changing a budget writes budget_changes rows'
  const first = await owner.client
    .from('project_budgets')
    .insert({ project_id: costProjectId, category: 'labour', amount: 3000 })
    .select('id, updated_by')
    .single()
  budgetId = first.data?.id
  const second = budgetId
    ? await owner.client.from('project_budgets').update({ amount: 3500 }).eq('id', budgetId).select('updated_by')
    : { error: first.error }
  const { data: log } = await owner.client
    .from('budget_changes')
    .select('old_amount, new_amount, changed_by')
    .eq('project_id', costProjectId)
    .order('changed_at')
  const steps = (log ?? []).map((row) => `${row.old_amount ?? 'none'} -> ${row.new_amount}`).join(', ')
  const byOwner = (log ?? []).every((row) => row.changed_by === owner.userId)
  if (first.error || second.error) {
    record(name, false, `Error: ${(first.error ?? second.error).message}`)
  } else if (log?.length !== 2 || Number(log[0].new_amount) !== 3000 || log[0].old_amount !== null ||
             Number(log[1].old_amount) !== 3000 || Number(log[1].new_amount) !== 3500 || !byOwner) {
    record(name, false, `Log: ${steps || 'empty'}.`)
  } else if (second.data?.[0]?.updated_by !== owner.userId) {
    record(name, false, 'The database did not stamp who changed it.')
  } else {
    record(name, true, `Logged automatically: ${steps}, by the owner.`)
  }
  covers('project_budgets', 'budget_changes', 'log_budget_change', 'project_budgets_before_write')
  if (!budgetId) stop('the remaining budget checks need a budget.')
}

{
  const name = 'Owner: budget vs spent for labour'
  const costs = await projectCosts()
  const labour = costs.byCategory?.labour
  if (costs.error) record(name, false, `Error: ${costs.error.message}`)
  else if (Number(labour.budget) !== 3500 || Number(labour.spent) !== 1100 || Number(labour.remaining) !== 2400 || Number(labour.percent_used) !== 31.4) {
    record(name, false, `Got: ${JSON.stringify(labour)}`)
  } else {
    record(name, true, 'Budget R3,500, spent R1,100 (with overtime), remaining R2,400, 31.4% used.')
  }
  covers('project_cost_vs_budget', 'project_budgets')
}

// --- Phase 6: the owner dashboard, on the same known data ---------------------
// Every number the dashboard shows comes from these functions, so checking
// them checks the screen's numbers.
const mondayOf = (isoDate) => {
  const date = new Date(`${isoDate}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7))
  return date.toISOString().slice(0, 10)
}

let dashFrom
let dashTo
{
  const name = 'Dashboard: "Project to date" runs from the first cost to today'
  const { data, error } = await owner.client.rpc('dashboard_period', {
    p_preset: 'project_to_date',
    p_project_id: costProjectId,
  })
  dashFrom = data?.[0]?.from_date
  dashTo = data?.[0]?.to_date
  if (error) record(name, false, `Error: ${error.message}`)
  else if (dashFrom !== COST_DAY_1 || dashTo !== saToday) record(name, false, `Got ${dashFrom} to ${dashTo}.`)
  else record(name, true, `${COST_DAY_1} to ${saToday} (today in South Africa).`)
  covers('dashboard_period')
  if (!dashFrom) stop('the dashboard checks need the period.')
}

{
  const name = 'Dashboard: headline "spent" is exactly R2,600, overtime shown separately'
  const { data, error } = await owner.client.rpc('dashboard_summary', {
    p_project_id: costProjectId,
    p_from: dashFrom,
    p_to: dashTo,
  })
  const s = data?.[0]
  if (error || !s) {
    record(name, false, `Error: ${error?.message ?? 'no row'}`)
  } else if (
    Number(s.spent) !== 2600 ||
    Number(s.spent_to_date) !== 2600 ||
    Number(s.budget) !== 3500 ||
    Number(s.remaining) !== 900 ||
    Number(s.percent_used) !== 74.3 ||
    Number(s.unpriced_hours) !== 2 ||
    Number(s.missing_rate_items) !== 1 ||
    Number(s.ot_hours) !== 2 ||
    Number(s.ot_pay) !== 300
  ) {
    record(name, false, `Got: ${JSON.stringify(s)}`)
  } else {
    record(name, true, 'Spent R2,600 incl. R300 overtime (2 h); budget R3,500, remaining R900, 74.3% used; 2 h unpriced (1 person).')
  }
  covers('dashboard_summary')
}

{
  const name = 'Dashboard: a date range only counts costs dated inside it'
  const { data, error } = await owner.client.rpc('dashboard_summary', {
    p_project_id: costProjectId,
    p_from: '2026-03-01',
    p_to: '2026-03-31',
  })
  const s = data?.[0]
  if (error || !s) record(name, false, `Error: ${error?.message ?? 'no row'}`)
  else if (Number(s.spent) !== 2100 || Number(s.spent_to_date) !== 2600) record(name, false, `Got: ${JSON.stringify(s)}`)
  else record(name, true, 'March: R2,100 (the reports); the fuel receipt is dated later. Spent to date still R2,600.')
  covers('dashboard_summary')
}

{
  const name = 'Dashboard: budget vs actual by category'
  const { data, error } = await owner.client.rpc('dashboard_categories', {
    p_project_id: costProjectId,
    p_from: dashFrom,
    p_to: dashTo,
  })
  const by = Object.fromEntries((data ?? []).map((row) => [row.category, row]))
  if (error) {
    record(name, false, `Error: ${error.message}`)
  } else if (
    data.length !== 8 ||
    Number(by.labour.budget) !== 3500 ||
    Number(by.labour.spent_to_date) !== 1100 ||
    Number(by.labour.percent_used) !== 31.4 ||
    by.labour.warning !== false ||
    by.owned_plant.budget !== null ||
    Number(by.owned_plant.spent_to_date) !== 1000 ||
    Number(by.fuel.spent_to_date) !== 500
  ) {
    record(name, false, `Got: ${JSON.stringify(data)}`)
  } else {
    record(name, true, 'All 8 categories; labour R1,100 of R3,500 (31.4%), owned plant R1,000 (no budget), fuel R500.')
  }
  covers('dashboard_categories')
}

{
  const name = 'Dashboard: a category over 90% of its budget is flagged red'
  const { error: budgetError } = await owner.client
    .from('project_budgets')
    .insert({ project_id: costProjectId, category: 'fuel', amount: 520 })
  const { data, error } = await owner.client.rpc('dashboard_categories', {
    p_project_id: costProjectId,
    p_from: dashFrom,
    p_to: dashTo,
  })
  const fuel = data?.find((row) => row.category === 'fuel')
  const labour = data?.find((row) => row.category === 'labour')
  if (budgetError || error) record(name, false, `Error: ${(budgetError ?? error).message}`)
  else if (fuel?.warning !== true || Number(fuel.percent_used) !== 96.2 || labour?.warning !== false) {
    record(name, false, `Got: fuel ${JSON.stringify(fuel)}, labour ${JSON.stringify(labour)}`)
  } else {
    record(name, true, 'Fuel R500 of R520 (96.2%) flagged; labour at 31.4% not flagged.')
  }
  covers('dashboard_categories')
}

{
  const name = 'Dashboard: spend per week, every week listed'
  const { data, error } = await owner.client.rpc('dashboard_weekly', {
    p_project_id: costProjectId,
    p_from: dashFrom,
    p_to: dashTo,
  })
  const receiptWeek = mondayOf(saToday)
  const rows = data ?? []
  const contiguous = rows.every(
    (row, i) => i === 0 || (Date.parse(row.week_start) - Date.parse(rows[i - 1].week_start)) / 86400000 === 7,
  )
  const amountFor = (week) => Number(rows.find((row) => row.week_start === week)?.spent ?? NaN)
  const others = rows.filter((row) => row.week_start !== COST_DAY_1 && row.week_start !== receiptWeek)
  if (error) {
    record(name, false, `Error: ${error.message}`)
  } else if (
    rows[0]?.week_start !== COST_DAY_1 ||
    rows.at(-1)?.week_start !== receiptWeek ||
    !contiguous ||
    amountFor(COST_DAY_1) !== 2100 ||
    amountFor(receiptWeek) !== 500 ||
    others.some((row) => Number(row.spent) !== 0)
  ) {
    record(name, false, `Got ${rows.length} week(s): ${JSON.stringify(rows.filter((row) => Number(row.spent) !== 0))}`)
  } else {
    record(name, true, `${rows.length} weeks: R2,100 in the week of ${COST_DAY_1}, R500 in the week of ${receiptWeek}, R0 in between.`)
  }
  covers('dashboard_weekly')
}

{
  const name = 'Dashboard: top vendors (approved receipts only)'
  const { data, error } = await owner.client.rpc('dashboard_top_vendors', {
    p_project_id: costProjectId,
    p_from: dashFrom,
    p_to: dashTo,
  })
  if (error) record(name, false, `Error: ${error.message}`)
  else if (data.length !== 1 || Number(data[0].amount) !== 500 || Number(data[0].receipts) !== 1) {
    record(name, false, `Got: ${JSON.stringify(data)}`)
  } else {
    record(name, true, `${data[0].vendor}: R500. The submitted R300 and rejected R200 receipts are left out.`)
  }
  covers('dashboard_top_vendors')
}

{
  const name = 'Dashboard: action items'
  const { data, error } = await owner.client.rpc('dashboard_action_items')
  const items = data?.[0]
  if (error || !items) record(name, false, `Error: ${error?.message ?? 'no row'}`)
  else if (Number(items.pending_receipts) < 1 || Number(items.missing_rate_items) < 1 || Number(items.unpriced_hours) < 2) {
    record(name, false, `Got: ${JSON.stringify(items)}`)
  } else {
    record(
      name,
      true,
      `${items.pending_receipts} pending receipt(s) (incl. the R300 test one), ${items.missing_rate_items} missing rate(s), ` +
        `${Number(items.unpriced_hours)} h unpriced (all projects).`,
    )
  }
  covers('dashboard_action_items')
}

{
  const name = 'Dashboard: employee hours calendar (submitted reports only)'
  const { data, error } = await owner.client.rpc('employee_hours_by_day', {
    p_employee_id: ratedEmployeeId,
    p_month: '2026-03-01',
    p_project_id: costProjectId,
  })
  const day = data?.[0]
  if (error) {
    record(name, false, `Error: ${error.message}`)
  } else if (
    data.length !== 1 ||
    day.day !== COST_DAY_1 ||
    Number(day.hours) !== 10 ||
    day.reports.length !== 1 ||
    day.reports[0].report_id !== reportA
  ) {
    record(name, false, `Got: ${JSON.stringify(data)}`)
  } else {
    record(name, true, `${COST_DAY_1}: 10 h on one report. The draft report's 3 h on ${COST_DAY_2} are left out.`)
  }
  covers('employee_hours_by_day')
}

{
  const name = 'Dashboard: employee month totals with overtime, labelled PROVISIONAL'
  const [rated, unrated] = await Promise.all(
    [ratedEmployeeId, unratedEmployeeId].map((id) =>
      owner.client.rpc('employee_month_summary', { p_employee_id: id, p_month: '2026-03-01', p_project_id: costProjectId }),
    ),
  )
  const r = rated.data?.[0]
  const u = unrated.data?.[0]
  if (rated.error || unrated.error || !r || !u) {
    record(name, false, `Error: ${(rated.error ?? unrated.error)?.message ?? 'no row'}`)
  } else if (
    Number(r.total_hours) !== 10 ||
    Number(r.provisional_cost) !== 1100 ||
    Number(r.ot_hours) !== 2 ||
    Number(r.ot_pay) !== 300 ||
    !r.basis.startsWith('PROVISIONAL') ||
    Number(u.total_hours) !== 2 ||
    Number(u.provisional_cost) !== 0 ||
    Number(u.unpriced_hours) !== 2
  ) {
    record(name, false, `Got: ${JSON.stringify({ rated: r, unrated: u })}`)
  } else {
    record(name, true, 'Rated: 10 h, R1,100 incl. 2 h overtime R300 (PROVISIONAL). Unrated: 2 h, R0, 2 h unpriced.')
  }
  covers('employee_month_summary')
}

// --- Dashboard insights (project health, spend vs budget, money mix) ----------
// Budgets on the test project by now: labour R3,500 + fuel R520 = R4,020.
{
  const name = 'Dashboard: project health board'
  const { data, error } = await owner.client.rpc('dashboard_projects', { p_from: dashFrom, p_to: dashTo })
  const row = data?.find((r) => r.project_id === costProjectId)
  if (error || !row) {
    record(name, false, `Error: ${error?.message ?? 'the test project is missing'}`)
  } else if (
    Number(row.budget) !== 4020 ||
    Number(row.spent_to_date) !== 2600 ||
    Number(row.remaining) !== 1420 ||
    Number(row.percent_used) !== 64.7 ||
    Number(row.unpriced_hours) !== 2 ||
    row.health !== 'on_track'
  ) {
    record(name, false, `Got: ${JSON.stringify(row)}`)
  } else {
    record(name, true, 'R2,600 of R4,020 (64.7%), 2 h unpriced, On track.')
  }
  covers('dashboard_projects')
}

{
  const name = 'Dashboard: spend vs budget over time (running total)'
  const { data, error } = await owner.client.rpc('dashboard_cumulative', { p_project_id: costProjectId })
  const rows = data ?? []
  const first = rows[0]
  const last = rows.at(-1)
  const contiguous = rows.every(
    (row, i) => i === 0 || (Date.parse(row.week_start) - Date.parse(rows[i - 1].week_start)) / 86400000 === 7,
  )
  if (error) {
    record(name, false, `Error: ${error.message}`)
  } else if (
    first?.week_start !== COST_DAY_1 ||
    Number(first.cumulative_spent) !== 2100 ||
    last?.week_start !== mondayOf(saToday) ||
    Number(last.cumulative_spent) !== 2600 ||
    Number(last.budget) !== 4020 ||
    !contiguous
  ) {
    record(name, false, `Got ${rows.length} week(s); first ${JSON.stringify(first)}, last ${JSON.stringify(last)}`)
  } else {
    record(name, true, `${rows.length} weeks: R2,100 by the week of ${COST_DAY_1}, R2,600 by this week; budget line R4,020.`)
  }
  covers('dashboard_cumulative')
}

{
  const name = 'Dashboard: weekly spend split into labour, owned plant and receipts'
  const { data, error } = await owner.client.rpc('dashboard_weekly_mix', {
    p_project_id: costProjectId,
    p_from: dashFrom,
    p_to: dashTo,
  })
  const week = (start) => data?.find((row) => row.week_start === start)
  const reports = week(COST_DAY_1)
  const receiptWeek = week(mondayOf(saToday))
  if (error) {
    record(name, false, `Error: ${error.message}`)
  } else if (
    Number(reports?.labour) !== 1100 ||
    Number(reports?.owned_plant) !== 1000 ||
    Number(reports?.receipts) !== 0 ||
    Number(reports?.total) !== 2100 ||
    Number(receiptWeek?.receipts) !== 500 ||
    Number(receiptWeek?.total) !== 500
  ) {
    record(name, false, `Got: ${JSON.stringify({ reports, receiptWeek })}`)
  } else {
    record(name, true, `Week of ${COST_DAY_1}: labour R1,100 + owned plant R1,000; receipt week: R500.`)
  }
  covers('dashboard_weekly_mix')
}

{
  const name = 'Dashboard: where the money goes (amounts and %)'
  const { data, error } = await owner.client.rpc('dashboard_mix', {
    p_project_id: costProjectId,
    p_from: dashFrom,
    p_to: dashTo,
  })
  const got = (data ?? []).map((row) => `${row.source} ${Number(row.amount)} ${Number(row.percent)}%`).join(', ')
  const expected = 'labour 1100 42.3%, owned_plant 1000 38.5%, receipts 500 19.2%'
  if (error) record(name, false, `Error: ${error.message}`)
  else record(name, got === expected, got === expected ? 'Labour R1,100 (42.3%), owned plant R1,000 (38.5%), receipts R500 (19.2%).' : `Got: ${got}`)
  covers('dashboard_mix')
}

// --- Drill-down (rework C): each level's total equals the figure tapped -------
// Same project and period as the dashboard checks above.
const drillArgs = { p_project_id: costProjectId, p_from: dashFrom, p_to: dashTo }
const dashFigures = await Promise.all([
  owner.client.rpc('dashboard_categories', drillArgs),
  owner.client.rpc('dashboard_summary', drillArgs),
  owner.client.rpc('dashboard_mix', drillArgs),
  owner.client.rpc('dashboard_top_vendors', drillArgs),
])
const failedFigure = dashFigures.find((result) => result.error)
if (failedFigure) stop(`the drill-down checks need the dashboard's figures: ${failedFigure.error.message}`)
const [dashCategoryRows, dashSummaryRows, dashMixRows, dashVendorRows] = dashFigures.map((result) => result.data)
const categoryFigure = (code) => Number(dashCategoryRows.find((row) => row.category === code)?.spent_in_range)
const receiptsFigure = Number(dashMixRows.find((row) => row.source === 'receipts')?.amount)

let labourRows = []
{
  const name = 'Drill-down: Labour per person adds up to R1,100 - the dashboard\'s Labour figure; overtime shown'
  const { data, error } = await owner.client.rpc('drill_hours', { ...drillArgs, p_category: 'labour' })
  labourRows = data ?? []
  const rated = labourRows.find((row) => row.who_id === ratedEmployeeId)
  const unrated = labourRows.find((row) => row.who_id === unratedEmployeeId)
  const total = Number(labourRows[0]?.total_cost)
  if (error) {
    record(name, false, `Error: ${error.message}`)
  } else if (total !== 1100 || total !== categoryFigure('labour') || Number(labourRows[0]?.total_ot_pay) !== 300) {
    record(name, false, `Drill-down total ${rand(total)}; dashboard Labour ${rand(categoryFigure('labour'))}.`)
  } else if (
    !rated ||
    Number(rated.hours) !== 10 ||
    Number(rated.days) !== 1 ||
    Number(rated.cost) !== 1100 ||
    Number(rated.ordinary_hours) !== 8 ||
    Number(rated.ot_hours) !== 2 ||
    Number(rated.ot_pay) !== 300 ||
    rated.rates.map(Number).join(',') !== '100' ||
    !unrated ||
    Number(unrated.unpriced_hours) !== 2 ||
    Number(unrated.cost) !== 0 ||
    Number(labourRows[0].total_hours) !== 12
  ) {
    record(name, false, `Rows: ${JSON.stringify(labourRows)}`)
  } else {
    record(name, true, 'R1,100 = the Labour figure. Rated: 10 h (8 ordinary + 2 overtime), 1 day, R100/h, R1,100 incl. R300 overtime. Unrated: 2 h unpriced. Draft hours left out.')
  }
  covers('drill_hours')
}

{
  const name = 'Drill-down: Owned plant per machine adds up to R1,000 - the dashboard\'s Owned plant figure'
  const { data, error } = await owner.client.rpc('drill_hours', { ...drillArgs, p_category: 'owned_plant' })
  const total = Number(data?.[0]?.total_cost)
  const only = data?.length === 1 ? data[0] : null
  if (error) record(name, false, `Error: ${error.message}`)
  else if (total !== 1000 || total !== categoryFigure('owned_plant')) {
    record(name, false, `Drill-down total ${rand(total)}; dashboard Owned plant ${rand(categoryFigure('owned_plant'))}.`)
  } else if (!only || only.who_id !== ownedPlantId || Number(only.hours) !== 4 || only.rates.map(Number).join(',') !== '250') {
    record(name, false, `Rows: ${JSON.stringify(data)}`)
  } else {
    record(name, true, 'R1,000 = the Owned plant figure: the owned machine, 4 h at R250/h. Rented plant left out.')
  }
  covers('drill_hours')
}

{
  const name = 'Drill-down: Fuel receipts add up to R500 - the dashboard\'s Fuel figure'
  const { data, error } = await owner.client.rpc('drill_receipts', { ...drillArgs, p_category: 'fuel', p_vendor: null })
  const total = Number(data?.[0]?.total_amount)
  if (error) record(name, false, `Error: ${error.message}`)
  else if (total !== 500 || total !== categoryFigure('fuel') || data.length !== 1 || !data[0].image_path) {
    record(name, false, `Drill-down total ${rand(total)}; dashboard Fuel ${rand(categoryFigure('fuel'))}; rows: ${JSON.stringify(data)}`)
  } else {
    record(name, true, `R500 = the Fuel figure: 1 approved receipt (${data[0].vendor}, uploaded by ${data[0].uploader_name}, with its photo path).`)
  }
  covers('drill_receipts')
}

{
  const name = 'Drill-down: all receipts add up to the dashboard\'s Receipts figure'
  const { data, error } = await owner.client.rpc('drill_receipts', { ...drillArgs, p_category: null, p_vendor: null })
  const total = Number(data?.[0]?.total_amount)
  if (error) record(name, false, `Error: ${error.message}`)
  else record(name, total === receiptsFigure && total === 500, `Drill-down ${rand(total)}; dashboard Receipts ${rand(receiptsFigure)}. Submitted and rejected receipts left out.`)
  covers('drill_receipts')
}

{
  const name = 'Drill-down: a vendor\'s receipts add up to their Top vendors figure (capitals don\'t matter)'
  const top = dashVendorRows[0]
  const { data, error } = await owner.client.rpc('drill_receipts', {
    ...drillArgs,
    p_category: null,
    p_vendor: top?.vendor?.toUpperCase() ?? 'none',
  })
  const total = Number(data?.[0]?.total_amount)
  if (error) record(name, false, `Error: ${error.message}`)
  else if (!top || total !== Number(top.amount)) record(name, false, `Vendor ${top?.vendor}: drill-down ${rand(total)}, Top vendors ${rand(top?.amount)}.`)
  else record(name, true, `${top.vendor}: ${rand(total)} both ways.`)
  covers('drill_receipts')
}

{
  const name = 'Drill-down: Unpriced hours list adds up to the dashboard\'s Unpriced figure (2 h)'
  const { data, error } = await owner.client.rpc('drill_unpriced', drillArgs)
  const total = Number(data?.[0]?.total_hours)
  const figure = Number(dashSummaryRows[0]?.unpriced_hours)
  const only = data?.length === 1 ? data[0] : null
  if (error) record(name, false, `Error: ${error.message}`)
  else if (total !== 2 || total !== figure) record(name, false, `Drill-down ${total} h; dashboard ${figure} h.`)
  else if (!only || only.who_id !== unratedEmployeeId || only.report_date !== COST_DAY_3 || only.report_id !== reportC) {
    record(name, false, `Rows: ${JSON.stringify(data)}`)
  } else {
    record(name, true, `2 h = the Unpriced figure: the unrated person on ${COST_DAY_3}, with the report.`)
  }
  covers('drill_unpriced')
}

{
  const name = "Drill-down: the rated person's days add up to their Labour row (R1,100 incl. overtime)"
  const { data, error } = await owner.client.rpc('drill_employee_days', { p_employee_id: ratedEmployeeId, ...drillArgs })
  const personRow = labourRows.find((row) => row.who_id === ratedEmployeeId)
  const only = data?.length === 1 ? data[0] : null
  if (error) record(name, false, `Error: ${error.message}`)
  else if (
    !only ||
    Number(only.total_cost) !== Number(personRow?.cost) ||
    Number(only.total_cost) !== 1100 ||
    Number(only.total_hours) !== 10 ||
    Number(only.ot_hours) !== 2 ||
    Number(only.ot_pay) !== 300 ||
    Number(only.total_ot_pay) !== 300 ||
    only.day !== COST_DAY_1 ||
    Number(only.rate) !== 100 ||
    only.reports?.[0]?.report_id !== reportA
  ) {
    record(name, false, `Rows: ${JSON.stringify(data)}; labour row: ${JSON.stringify(personRow)}`)
  } else {
    record(name, true, `${COST_DAY_1}: 8 h x R100 + 2 h overtime x R150 = R1,100, with the report. The draft's 3 h on ${COST_DAY_2} left out.`)
  }
  covers('drill_employee_days')
}

// --- Exports (phase 7a): the app's OWN Excel files, built here -----------------
// Finds a column by its header text, on the sheet's header row.
function columnOf(sheet, header) {
  let found = null
  sheet.eachRow((row, rowNumber) => {
    row.eachCell((cell, columnNumber) => {
      if (!found && cell.value === header) found = { column: columnNumber, row: rowNumber }
    })
  })
  return found
}
// The cell in the "Total" row under a header: { value, formula, numFmt }.
function sheetTotal(workbook, sheetName, header) {
  const sheet = workbook.getWorksheet(sheetName)
  const at = sheet && columnOf(sheet, header)
  let cell = null
  sheet?.eachRow((row) => {
    if (row.getCell(1).value === 'Total') cell = row.getCell(at.column)
  })
  const value = cell?.value
  return { value: Number(value?.result ?? value), formula: value?.formula ?? null, numFmt: cell?.numFmt ?? null }
}
// A person's row on a sheet: their value under a header.
function personValue(workbook, sheetName, personName, header) {
  const sheet = workbook.getWorksheet(sheetName)
  const at = columnOf(sheet, header)
  let value
  sheet.eachRow((row) => {
    if (row.getCell(1).value === personName) value = row.getCell(at.column).value
  })
  return value
}
const costProjectName = `${COST_PREFIX} ${RUN_TAG}`
const exportMeta = {
  company: 'RLS test company',
  projects: [{ id: costProjectId, name: costProjectName }],
  from: dashFrom,
  to: dashTo,
  generatedBy: 'RLS test',
  generatedAt: new Date(),
}
const ratedName = `ZZ Costing Rated ${RUN_TAG}`
const unratedName = `ZZ Costing Unrated ${RUN_TAG}`

{
  const name = "Export 1 (the app's own file): Summary total exactly R2,600 = the dashboard's Spent; overtime columns"
  try {
    const data = await fetchProjectCost(owner.client, { projects: exportMeta.projects, from: dashFrom, to: dashTo })
    const { workbook, filename } = buildProjectCost(data, exportMeta)
    const summary = sheetTotal(workbook, 'Summary', 'Spent in period')
    const labour = sheetTotal(workbook, 'Labour', 'Cost (provisional)')
    const receipts = sheetTotal(workbook, 'Receipts', 'Total paid (VAT inclusive)')
    const rate = personValue(workbook, 'Labour', ratedName, 'Rate (R/h)')
    const rateFrom = personValue(workbook, 'Labour', ratedName, 'Rate from')
    const dashSpent = Number(dashSummaryRows[0]?.spent)
    const expectedName = `nkutwala_project-cost_${costProjectName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}_${dashFrom}_${dashTo}.xlsx`
    const problems = [
      summary.value === 2600 && summary.value === dashSpent ? null : `Summary total ${summary.value}, dashboard ${dashSpent}`,
      summary.formula?.startsWith('SUM(') && summary.numFmt === '"R" #,##0.00' ? null : `Total cell: ${JSON.stringify(summary)}`,
      labour.value === 1100 ? null : `Labour total ${labour.value}`,
      personValue(workbook, 'Labour', ratedName, 'Overtime hours') === 2 &&
      personValue(workbook, 'Labour', ratedName, 'Overtime pay') === 300 &&
      personValue(workbook, 'Labour', ratedName, 'Ordinary pay') === 800
        ? null
        : 'Rated person\'s overtime columns are wrong',
      sheetTotal(workbook, 'Labour', 'Overtime pay').value === 300 ? null : 'Overtime pay total is wrong',
      receipts.value === 500 ? null : `Receipts total ${receipts.value}`,
      rate === 100 && rateFrom instanceof Date && rateFrom.toISOString().slice(0, 10) === '2026-01-01'
        ? null
        : `Rated person's rate: ${rate} from ${rateFrom}`,
      filename === expectedName ? null : `File name ${filename}`,
    ].filter(Boolean)
    record(
      name,
      problems.length === 0,
      problems.length ? problems.join('; ') : 'Summary R2,600 (a SUM formula in R format); Labour R1,100 at R100/h from 1 Jan 2026 (R800 ordinary + R300 for 2 h overtime); Receipts R500 VAT inclusive.',
    )
  } catch (error) {
    record(name, false, `Could not build it: ${error.message}`)
  }
  covers('export_cost_summary', 'export_labour', 'drill_receipts', 'dashboard_weekly_mix')
}

{
  const name = "Export 2 (the app's own file): payroll lists the rated person at R1,100 gross incl. overtime; unpriced hours shown"
  try {
    const data = await fetchPayrollHours(owner.client, { projects: null, from: COST_DAY_1, to: COST_DAY_3 })
    const { workbook } = buildPayrollHours(data, { ...exportMeta, projects: null, from: COST_DAY_1, to: COST_DAY_3 })
    const rated = data.people.find((person) => person.employee_id === ratedEmployeeId)
    const unrated = data.people.find((person) => person.employee_id === unratedEmployeeId)
    const sheets = workbook.worksheets.map((sheet) => sheet.name).join(', ')
    const warning = workbook.getWorksheet('Payroll hours').getRow(1).getCell(1).value
    const problems = [
      rated?.included && Number(rated.hours) === 10 && Number(rated.gross) === 1100 && Number(rated.ot_pay) === 300
        ? null
        : `Rated: ${JSON.stringify(rated)}`,
      unrated?.included && Number(unrated.unpriced_hours) === 2 && Number(unrated.gross) === 0 ? null : `Unrated: ${JSON.stringify(unrated)}`,
      personValue(workbook, 'Payroll hours', ratedName, 'Gross (provisional)') === 1100 ? null : 'Rated gross not on the sheet',
      personValue(workbook, 'Payroll hours', ratedName, 'Overtime hours') === 2 ? null : 'Rated overtime hours not on the sheet',
      personValue(workbook, 'Payroll hours', unratedName, 'Unpriced hours (no rate on the day)') === 2 ? null : 'Unpriced hours not on the sheet',
      sheets === 'Payroll hours, Daily grid, Excluded' ? null : `Sheets: ${sheets}`,
      warning === PAY_TITLE && !String(warning).includes('OVERTIME') ? null : `Title: ${warning}`,
    ].filter(Boolean)
    record(name, problems.length === 0, problems.length ? problems.join('; ') : 'Rated: 10 h (2 h overtime), R1,100 gross. Unrated: 2 h unpriced, R0. Three sheets; "NOT A PAYSLIP" in the title, no "overtime not applied".')
  } catch (error) {
    record(name, false, `Could not build it: ${error.message}`)
  }
  covers('export_payroll', 'export_labour', 'export_daily_hours')
}

// --- The export log ------------------------------------------------------------
{
  const name = 'Owner logs an export; it is in the log, recorded as them'
  const marker = `rls-test-${RUN_TAG}`
  const { error } = await owner.client.from('export_log').insert({ report_type: 'project_cost', filters: { marker } })
  const { data } = await owner.client.from('export_log').select('user_id, report_type').eq('filters->>marker', marker)
  if (error) record(name, false, `Could not log it: ${error.message}`)
  else record(name, data?.length === 1 && data[0].user_id === owner.userId, `Found: ${JSON.stringify(data)}`)
  covers('export_log', 'export_log_before_insert')
}
{
  const name = 'Site manager logs their own export (allowed), but can read NO export log rows'
  const { error } = await site.client.from('export_log').insert({ report_type: 'my_labour_return', filters: { marker: `rls-site-${RUN_TAG}` } })
  const read = await site.client.from('export_log').select('id')
  if (error) record(name, false, `Could not log their own export: ${error.message}`)
  else if (read.error) record(name, false, `Unexpected error reading: ${read.error.message}`)
  else record(name, read.data.length === 0, read.data.length === 0 ? 'Logged; 0 rows readable.' : `LEAK: ${read.data.length} log rows readable.`)
  covers('export_log')
}
await attackInsert('Site manager logs an export as someone else', site.client, 'export_log', {
  report_type: 'project_cost',
  filters: {},
  user_id: owner.userId,
})
{
  const name = 'Site manager changes or deletes export log rows'
  const changed = await site.client.from('export_log').update({ report_type: 'payroll_hours' }).neq('report_type', 'zz').select('id')
  const deleted = await site.client.from('export_log').delete().neq('report_type', 'zz').select('id')
  const ok = (changed.error || changed.data.length === 0) && (deleted.error || deleted.data.length === 0)
  record(name, ok, ok ? 'Refused / nothing changed.' : 'BREACH: rows were changed or deleted.')
  covers('export_log')
}

// Site manager: every dashboard and export function, on data that includes
// THEIR OWN reports and receipts - nothing at all may come back.
const exportArgs = { p_project_ids: [costProjectId], p_from: dashFrom, p_to: dashTo }
const allExportArgs = { p_project_ids: null, p_from: dashFrom, p_to: dashTo }
for (const [fn, args, note] of [
  ['export_cost_summary', exportArgs, ''],
  ['export_cost_summary', allExportArgs, ' for all projects'],
  ['export_labour', exportArgs, ''],
  ['export_labour', allExportArgs, ' for all projects'],
  ['export_payroll', exportArgs, ''],
  ['export_payroll', allExportArgs, ' for all projects'],
  ['export_daily_hours', exportArgs, ''],
  ['export_daily_hours', allExportArgs, ' for all projects'],
  ['export_receipts', exportArgs, ''],
  ['export_receipts', allExportArgs, ' for all projects'],
  ['export_weekly', exportArgs, ''],
  ['export_weekly', allExportArgs, ' for all projects'],
  ['export_period', { p_preset: 'project_to_date', p_project_ids: [costProjectId] }, ''],
  ['export_period', { p_preset: 'this_month', p_project_ids: null }, ' for all projects'],
  ['drill_hours', { ...drillArgs, p_category: 'labour' }, ''],
  ['drill_hours', { ...drillArgs, p_category: 'owned_plant' }, ' for owned plant'],
  ['drill_hours', { p_project_id: null, p_from: dashFrom, p_to: dashTo, p_category: 'labour' }, ' for all projects'],
  ['drill_receipts', { ...drillArgs, p_category: null, p_vendor: null }, ''],
  ['drill_receipts', { ...drillArgs, p_category: 'fuel', p_vendor: null }, ' for fuel'],
  ['drill_unpriced', drillArgs, ''],
  ['drill_unpriced', { p_project_id: null, p_from: dashFrom, p_to: dashTo }, ' for all projects'],
  ['drill_employee_days', { p_employee_id: ratedEmployeeId, ...drillArgs }, ''],
  ['drill_employee_days', { p_employee_id: randomUUID(), p_project_id: randomUUID(), p_from: dashFrom, p_to: dashTo }, ' with made-up ids'],
  ['dashboard_period', { p_preset: 'project_to_date', p_project_id: costProjectId }, ''],
  ['dashboard_summary', { p_project_id: costProjectId, p_from: dashFrom, p_to: dashTo }, ''],
  ['dashboard_summary', { p_project_id: null, p_from: dashFrom, p_to: dashTo }, ' for all projects'],
  ['dashboard_categories', { p_project_id: costProjectId, p_from: dashFrom, p_to: dashTo }, ''],
  ['dashboard_weekly', { p_project_id: costProjectId, p_from: dashFrom, p_to: dashTo }, ''],
  ['dashboard_top_vendors', { p_project_id: costProjectId, p_from: dashFrom, p_to: dashTo }, ''],
  ['dashboard_action_items', {}, ''],
  ['employee_hours_by_day', { p_employee_id: ratedEmployeeId, p_month: '2026-03-01', p_project_id: null }, ''],
  ['employee_month_summary', { p_employee_id: ratedEmployeeId, p_month: '2026-03-01', p_project_id: null }, ''],
  ['dashboard_projects', { p_from: dashFrom, p_to: dashTo }, ''],
  ['dashboard_cumulative', { p_project_id: costProjectId }, ''],
  ['dashboard_cumulative', { p_project_id: null }, ' for all projects'],
  ['dashboard_weekly_mix', { p_project_id: costProjectId, p_from: dashFrom, p_to: dashTo }, ''],
  ['dashboard_mix', { p_project_id: costProjectId, p_from: dashFrom, p_to: dashTo }, ''],
]) {
  const name = `Site manager calls ${fn}()${note}`
  const { data, error } = await site.client.rpc(fn, args)
  const empty = Array.isArray(data) ? data.length === 0 : data === null
  if (error?.code === PERMISSION_DENIED) record(name, true, 'Server refused (permission denied).')
  else if (error) record(name, false, `Unexpected error: ${error.message}`)
  else if (!empty) record(name, false, `LEAK: ${JSON.stringify(data).slice(0, 200)}`)
  else record(name, true, 'Nothing came back (it includes their own reports and receipts).')
  covers(fn)
}

await attackUpdate(
  "Owner moves a budget to another category",
  owner,
  owner,
  'project_budgets',
  budgetId,
  { category: 'fuel' },
  'category',
)
covers('project_budgets')

{
  const name = 'Owner: budget changes are in the audit log'
  const { data, error } = await owner.client
    .from('audit_log')
    .select('action')
    .eq('entity', 'project_budgets')
    .eq('entity_id', budgetId)
  if (error) record(name, false, `Error: ${error.message}`)
  else record(name, data.length >= 2, `${data.length} audit row(s): ${data.map((row) => row.action).join(', ')}.`)
  covers('audit_row_change')
}

// --- Owner: equipment rates are voided, never edited --------------------------
{
  const wrongRateId = await ownerInsert(
    'equipment_rates',
    { equipment_id: ownedPlantId, hourly_rate: 999, effective_from: '2026-06-01' },
    'a deliberately wrong equipment rate',
  )
  await attackInsert(
    'Owner adds a second live rate for the same machine and start date',
    owner.client,
    'equipment_rates',
    { equipment_id: ownedPlantId, hourly_rate: 1, effective_from: '2026-06-01' },
    '23505',
    'Refused: there is already a live rate from that date (void it first).',
  )
  covers('equipment_rates')

  const noReason = await owner.client.from('equipment_rates').update({ void_reason: '  ' }).eq('id', wrongRateId).select('id')
  record(
    'Owner voids an equipment rate with a blank reason',
    noReason.error?.code === '23514',
    noReason.error ? `Refused: ${noReason.error.message}` : 'BREACH: voided without a reason.',
  )
  covers('equipment_rates', 'equipment_rates_before_update')

  const voided = await owner.client
    .from('equipment_rates')
    .update({ void_reason: 'RLS costing test: wrong on purpose' })
    .eq('id', wrongRateId)
    .select('voided_at, voided_by')
  record(
    'Owner voids a wrong equipment rate with a reason',
    !voided.error && voided.data?.[0]?.voided_at && voided.data[0].voided_by === owner.userId,
    voided.error ? `Error: ${voided.error.message}` : 'Voided; the database stamped when and who. It stays in the history.',
  )
  covers('equipment_rates', 'equipment_rates_before_update', 'audit_row_change')
}

// --- Site manager attacks (the data above now exists) -------------------------
for (const table of ['project_budgets', 'budget_changes', 'equipment_rates']) {
  await attackReadNothing(`Site manager reads ${table}`, site.client, table)
  covers(table)
}
for (const view of [
  'project_cost_lines',
  'unpriced_hours',
  'project_cost_vs_budget',
  'project_cost_by_week',
  'vendor_spend',
  'labour_provisional_by_employee_week',
]) {
  await attackReadNothing(`Site manager reads ${view} (their own report hours are in it)`, site.client, view)
  covers(view)
}

await attackInsert('Site manager adds a budget', site.client, 'project_budgets', {
  project_id: costProjectId,
  category: 'fuel',
  amount: 1,
})
covers('project_budgets')
await attackUpdate('Site manager changes a budget', site, owner, 'project_budgets', budgetId, { amount: 1 }, 'amount')
covers('project_budgets')
await attackInsert('Site manager writes to budget_changes', site.client, 'budget_changes', {
  company_id: companyId,
  project_id: costProjectId,
  category: 'labour',
  new_amount: 1,
})
covers('budget_changes')
await attackInsert('Site manager adds an equipment rate', site.client, 'equipment_rates', {
  equipment_id: ownedPlantId,
  hourly_rate: 1,
  effective_from: '2030-01-01',
})
covers('equipment_rates')
await attackInsert(
  'Site manager adds a cost category',
  site.client,
  'cost_categories',
  { code: 'zz_attack', label: 'Attack', sort_order: 99, source: 'receipts' },
  PERMISSION_DENIED,
  'Server refused.',
  'code', // cost_categories is keyed by code, not id
)
covers('cost_categories')

for (const [fn, args] of [
  ['equipment_rate_on', { p_equipment_id: ownedPlantId, p_date: COST_DAY_1 }],
  ['rate_on', { p_employee_id: ratedEmployeeId, p_date: COST_DAY_1 }],
]) {
  const name = `Site manager calls ${fn}() for something that HAS a rate`
  const { data, error } = await site.client.rpc(fn, args)
  if (error?.code === PERMISSION_DENIED) record(name, true, 'Server refused (permission denied).')
  else if (error) record(name, false, `Unexpected error: ${error.message}`)
  else if (data !== null) record(name, false, `LEAK: ${fn} returned ${data} to a site manager.`)
  else record(name, true, 'Returned nothing.')
  covers(fn)
}

for (const fn of ['log_budget_change', 'equipment_rates_before_insert', 'equipment_rates_before_update', 'project_budgets_before_write', 'audit_row_change']) {
  const name = `Site manager calls the trigger function ${fn}() directly`
  const { error } = await site.client.rpc(fn, {})
  record(name, Boolean(error), error ? `Refused: ${error.message}` : 'BREACH: it ran.')
  covers(fn)
}

{
  const name = "The app's category list matches the database's cost_categories"
  const { data, error } = await site.client.from('cost_categories').select('code, label').order('sort_order')
  const db = (data ?? []).map((row) => `${row.code}=${row.label}`).join(', ')
  const app = Object.entries(COST_CATEGORY_LABELS).map(([code, label]) => `${code}=${label}`).join(', ')
  if (error) record(name, false, `Error: ${error.message}`)
  else record(name, db === app, db === app ? `${data.length} categories, same order and names.` : `Database: ${db}\n          App:      ${app}`)
  covers('cost_categories')
}

// --- Finish off this run's test data (nothing can be deleted) -----------------
{
  const steps = [
    changeReceipt(owner, materialsReceiptId, { status: 'rejected', review_reason: 'RLS costing test: tidy-up' }),
    changeReceipt(admin, fuelReceiptId, { status: 'reversed', review_reason: 'RLS costing test: tidy-up' }),
    owner.client.from('projects').update({ status: 'complete' }).eq('id', costProjectId).select('id'),
  ]
  const outcomes = await Promise.all(steps)
  const failed = outcomes.find((outcome) => outcome.error)
  if (failed) console.log(`          (note: tidy-up incomplete: ${failed.error.message})`)
}

// =============================================================================
// New employees and project teams (rework B)
// =============================================================================
// Site managers may add people - only as Pending - and put people on a
// project's team. Only owners/admins approve, never without a rate, and a
// pending person's hours stay unpriced until then. This uses its own
// project, so the costing totals above stay exact.
console.log('\nNew employee and project team attacks…\n')

const PENDING_PREFIX = 'ZZ Pending Test'
const PENDING_DAY = '2026-04-06' // a Monday

// Finish off what an interrupted run left behind: its project, and any test
// people still waiting for approval.
{
  const [projects, people] = await Promise.all([
    owner.client
      .from('projects')
      .update({ status: 'complete' })
      .like('name', `${PENDING_PREFIX}%`)
      .eq('status', 'active'),
    owner.client
      .from('employees')
      .update({ status: 'inactive', reject_reason: 'RLS test: tidy-up' })
      .like('full_name', 'ZZ Pending%')
      .eq('status', 'pending'),
  ])
  const failed = projects.error ?? people.error
  if (failed) stop(`owner could not tidy up old pending test data: ${failed.message}`)
}

const pendingProjectId = await ownerInsert(
  'projects',
  { name: `${PENDING_PREFIX} ${RUN_TAG}`, status: 'active' },
  'the pending test project',
)

// The owner's view of a person: status and the database's stamps.
async function readPerson(employeeId) {
  const { data } = await owner.client
    .from('employees')
    .select('full_name, category, phone, status, created_by, approved_at, approved_by, rejected_at, reject_reason')
    .eq('id', employeeId)
    .single()
  return data
}

// The owner's view of the pending test project's costs.
async function pendingProjectCosts() {
  const { data, error } = await owner.client
    .from('project_cost_vs_budget')
    .select('spent, unpriced_hours')
    .eq('project_id', pendingProjectId)
  if (error) return { error }
  return {
    spent: data.reduce((sum, row) => sum + Number(row.spent), 0),
    unpriced: data.reduce((sum, row) => sum + Number(row.unpriced_hours), 0),
  }
}

// --- Site manager 1 adds a person, the app's way --------------------------------
const pendingName = `ZZ Pending Person ${RUN_TAG}`
let pendingPerson = null
{
  const name = "Site manager adds a new person (the app's way): Pending, added by them"
  try {
    pendingPerson = await addEmployee(site.client, {
      fullName: pendingName,
      category: 'general_worker',
      phone: '082 000 0000',
    })
    const ok =
      pendingPerson.status === 'pending' &&
      pendingPerson.created_by === site.userId &&
      pendingPerson.approved_at === null
    record(name, ok, ok ? 'Saved as Pending; the database recorded who added them.' : `Got: ${JSON.stringify(pendingPerson)}`)
  } catch (error) {
    record(name, false, `Could not add them: ${error.message}`)
  }
  covers('employees_before_write')
}
if (!pendingPerson) stop('the new-employee checks need the person site manager 1 adds')

{
  const name = 'Site manager fixes the details of the pending person they added'
  try {
    const updated = await updateEmployeeDetails(site.client, pendingPerson.id, {
      fullName: pendingName,
      category: 'semi_skilled',
      phone: '',
    })
    const ok = updated.category === 'semi_skilled' && updated.phone === null && updated.status === 'pending'
    record(name, ok, ok ? 'Category and phone changed; still Pending.' : `Got: ${JSON.stringify(updated)}`)
  } catch (error) {
    record(name, false, `Could not change them: ${error.message}`)
  }
  covers('employees_before_write')
}

for (const [label, changes] of [
  ['approves the person they added', { status: 'approved' }],
  ['rejects the person they added', { status: 'inactive', reject_reason: 'attack' }],
]) {
  const name = `Site manager ${label}`
  const { data, error } = await site.client.from('employees').update(changes).eq('id', pendingPerson.id).select('id')
  const after = await readPerson(pendingPerson.id)
  if (after?.status !== 'pending') record(name, false, `BREACH: the status is now ${after?.status}.`)
  else if (error) record(name, true, `Refused: ${error.message}`)
  else record(name, data.length === 0, data.length === 0 ? 'Changed nothing.' : 'Update reported success.')
  covers('employees_before_write')
}

{
  const name = 'Site manager approves the person they added with approve_employee()'
  const { error } = await site.client.rpc('approve_employee', {
    p_employee_id: pendingPerson.id,
    p_hourly_rate: 1,
    p_effective_from: PENDING_DAY,
  })
  const after = await readPerson(pendingPerson.id)
  const { data: rates } = await owner.client.from('employee_rates').select('id').eq('employee_id', pendingPerson.id)
  if (after?.status !== 'pending' || (rates ?? []).length > 0) {
    record(name, false, `BREACH: status ${after?.status}, ${rates?.length} rate(s).`)
  } else {
    record(name, error?.code === PERMISSION_DENIED, error ? `Refused: ${error.message}` : 'No error came back.')
  }
  covers('approve_employee')
}

await attackInsert('Site manager adds a rate for the person they added', site.client, 'employee_rates', {
  employee_id: pendingPerson.id,
  hourly_rate: 1,
  effective_from: '2030-01-01',
})

await attackUpdate(
  'Site manager 2 renames the pending person site manager 1 added',
  site2,
  owner,
  'employees',
  pendingPerson.id,
  { full_name: 'HACKED' },
  'full_name',
)
covers('employees_before_write')

{
  const name = 'Same-name check finds the person, whatever the capitals and spaces'
  try {
    const matches = await findDuplicates(site.client, `  zz   pending person ${RUN_TAG.toUpperCase()} `)
    const allowed = ['id', 'full_name', 'category', 'status']
    const extra = [...new Set(matches.flatMap((match) => Object.keys(match)))].filter((key) => !allowed.includes(key))
    if (!matches.some((match) => match.id === pendingPerson.id)) {
      record(name, false, `Not found: ${JSON.stringify(matches)}`)
    } else {
      record(name, extra.length === 0, extra.length ? `Unexpected columns: ${extra.join(', ')}` : 'Found; only name, category and status came back.')
    }
  } catch (error) {
    record(name, false, `Error: ${error.message}`)
  }
  covers('employee_duplicates')
}

for (const fn of ['employees_before_write', 'project_employees_before_write']) {
  const name = `Site manager calls the trigger function ${fn}() directly`
  const { error } = await site.client.rpc(fn, {})
  record(name, Boolean(error), error ? `Refused: ${error.message}` : 'BREACH: it ran.')
  covers(fn)
}

await attackReadNothing('Site manager reads pending_employees', site.client, 'pending_employees')
covers('pending_employees')

// --- Project teams ---------------------------------------------------------------
let teamRowId = null
{
  const name = "Site manager puts the new person on the project's team (the app's way)"
  try {
    await assignToProject(site.client, pendingProjectId, pendingPerson.id)
    const team = await fetchTeam(site.client, pendingProjectId)
    const { data: row } = await site.client
      .from('project_employees')
      .select('id, assigned_by, active')
      .eq('project_id', pendingProjectId)
      .eq('employee_id', pendingPerson.id)
      .single()
    teamRowId = row?.id ?? null
    const ok = team.some((person) => person.id === pendingPerson.id) && row?.assigned_by === site.userId && row.active
    record(name, ok, ok ? 'On the team; the database recorded who assigned them.' : `Team: ${JSON.stringify(team)}; row: ${JSON.stringify(row)}`)
  } catch (error) {
    record(name, false, `Error: ${error.message}`)
  }
  covers('project_employees', 'assign_to_project', 'project_employees_before_write')
}

{
  const name = 'Site manager reads project_employees (allowed, no money fields)'
  const { data, error } = await site.client.from('project_employees').select('*')
  if (error) {
    record(name, false, `Could not read project_employees: ${error.message}`)
  } else if (data.length === 0) {
    record(name, false, 'Inconclusive: zero rows came back, so the columns couldn\'t be checked.')
  } else {
    const unexpected = [...new Set(data.flatMap((row) => Object.keys(row)))].filter(
      (column) => !ALLOWED_COLUMNS.project_employees.includes(column),
    )
    record(
      name,
      unexpected.length === 0,
      unexpected.length ? `Unapproved column(s) sent to a site manager: ${unexpected.join(', ')}.` : `${data.length} row(s), only approved columns.`,
    )
  }
  covers('project_employees')
}

{
  const name = 'Site manager takes the person off the team, then puts them back'
  try {
    await removeFromProject(site.client, pendingProjectId, pendingPerson.id)
    const off = await fetchTeam(site.client, pendingProjectId)
    await assignToProject(site.client, pendingProjectId, pendingPerson.id)
    const back = await fetchTeam(site.client, pendingProjectId)
    const ok = !off.some((person) => person.id === pendingPerson.id) && back.some((person) => person.id === pendingPerson.id)
    record(name, ok, ok ? 'Off, then on again (the row is kept - never deleted).' : 'The team did not change as expected.')
  } catch (error) {
    record(name, false, `Error: ${error.message}`)
  }
  covers('project_employees', 'assign_to_project', 'project_employees_before_write')
}

{
  const name = 'Site manager puts an inactive person on a team'
  const { error } = await site.client.rpc('assign_to_project', {
    p_project_id: pendingProjectId,
    p_employee_id: ratedEmployeeId,
  })
  record(name, error?.code === PERMISSION_DENIED, error ? `Refused: ${error.message}` : 'BREACH: they were added.')
  covers('assign_to_project')
}

if (teamRowId) {
  await attackUpdate(
    'Site manager moves a team row to another project',
    site,
    owner,
    'project_employees',
    teamRowId,
    { project_id: costProjectId },
    'project_id',
  )
  covers('project_employees')
}

// --- Hours for a pending person, and an Absent line ------------------------------
let pendingReportId = null
{
  const name = 'Site manager logs 4 h for the pending person and marks someone Absent (0 h)'
  const { data, error } = await site.client.rpc('save_report_draft', {
    p_report: { project_id: pendingProjectId, report_date: PENDING_DAY, activities: `RLS pending test ${RUN_TAG}` },
    p_crew: [
      { employee_id: pendingPerson.id, hours: 4 },
      // No rate on this day: if Absent counted, it would show as unpriced.
      { employee_id: unratedEmployeeId, hours: 0 },
    ],
    p_equipment: [],
  })
  pendingReportId = data ?? null
  record(name, !error && Boolean(data), error ? `Could not save: ${error.message}` : 'Saved; the absent person stays on the report with 0 h.')
  covers('save_report_draft')
}
if (!pendingReportId) stop('the pending-hours checks need site manager 1\'s report')

{
  const name = 'Site manager saves a crew line with negative hours'
  const { error } = await site.client.rpc('save_report_draft', {
    p_report: { id: pendingReportId, project_id: pendingProjectId, report_date: PENDING_DAY },
    p_crew: [{ employee_id: pendingPerson.id, hours: -1 }],
    p_equipment: [],
  })
  if (error?.code === '23514') record(name, true, 'Refused: hours must be 0 to 24.')
  else if (error) record(name, false, `Refused for the wrong reason (${error.code}): ${error.message}`)
  else record(name, false, 'BREACH: negative hours were saved.')
}

{
  const { data, error } = await site.client
    .from('daily_reports')
    .update({ status: 'submitted' })
    .eq('id', pendingReportId)
    .select('id')
  if (error || data.length !== 1) stop(`site manager 1 could not submit the pending test report: ${error?.message}`)
}

{
  const name = "Owner: the pending person's 4 h are unpriced and cost nothing; Absent adds nothing"
  const costs = await pendingProjectCosts()
  const { data: unpriced, error } = await owner.client
    .from('unpriced_hours')
    .select('employee_id, hours, employee_status')
    .eq('project_id', pendingProjectId)
  const only = unpriced?.length === 1 ? unpriced[0] : null
  if (costs.error || error) {
    record(name, false, `Error: ${(costs.error ?? error).message}`)
  } else if (costs.spent !== 0) {
    record(name, false, `Spent ${rand(costs.spent)} - it should be R0.`)
  } else if (
    costs.unpriced !== 4 ||
    !only ||
    only.employee_id !== pendingPerson.id ||
    Number(only.hours) !== 4 ||
    only.employee_status !== 'pending'
  ) {
    record(name, false, `Unpriced: ${costs.unpriced} h; list: ${JSON.stringify(unpriced)}`)
  } else {
    record(name, true, 'R0 spent; 4 h unpriced, listed as Pending. The absent line is in neither.')
  }
  covers('rate_on', 'unpriced_hours')
}

{
  const name = "Owner: the pending person's labour summary costs R0, with 4 h unpriced"
  const { data, error } = await owner.client.rpc('employee_month_summary', {
    p_employee_id: pendingPerson.id,
    p_month: '2026-04-01',
    p_project_id: pendingProjectId,
  })
  const row = data?.[0]
  if (error || !row) {
    record(name, false, `Error: ${error?.message ?? 'no row'}`)
  } else {
    const ok = Number(row.total_hours) === 4 && Number(row.provisional_cost) === 0 && Number(row.unpriced_hours) === 4
    record(name, ok, ok ? '4 h, R0, 4 h unpriced.' : `Got: ${JSON.stringify(row)}`)
  }
  covers('rate_on')
}

{
  const name = 'Owner: the New employees queue shows them, who added them and their hours'
  const { data, error } = await owner.client
    .from('pending_employees')
    .select('id, created_by, added_by_name, hours_logged, first_worked')
    .eq('id', pendingPerson.id)
  const row = data?.[0]
  if (error || !row) {
    record(name, false, `Error: ${error?.message ?? 'not in the queue'}`)
  } else {
    const ok =
      row.created_by === site.userId &&
      Boolean(row.added_by_name) &&
      Number(row.hours_logged) === 4 &&
      row.first_worked === PENDING_DAY
    record(name, ok, ok ? `Added by ${row.added_by_name}; 4 h from ${PENDING_DAY}.` : `Got: ${JSON.stringify(row)}`)
  }
  covers('pending_employees')
}

{
  const name = 'Export 2 before approval: the pending person is only on the Excluded sheet, with their 4 h'
  try {
    const data = await fetchPayrollHours(owner.client, { projects: null, from: PENDING_DAY, to: PENDING_DAY })
    const { workbook } = buildPayrollHours(data, { ...exportMeta, projects: null, from: PENDING_DAY, to: PENDING_DAY })
    const row = data.people.find((person) => person.employee_id === pendingPerson.id)
    const onPayroll = personValue(workbook, 'Payroll hours', pendingName, 'Hours')
    const onExcluded = personValue(workbook, 'Excluded', pendingName, 'Hours')
    const ok = row && row.included === false && Number(row.hours) === 4 && onPayroll === undefined && onExcluded === 4
    record(name, ok, ok ? 'Not on the payroll sheet; on Excluded with 4 h - nothing silently dropped.' : `Row: ${JSON.stringify(row)}; payroll ${onPayroll}; excluded ${onExcluded}`)
  } catch (error) {
    record(name, false, `Could not build it: ${error.message}`)
  }
  covers('export_payroll')
}

// --- The owner decides ---------------------------------------------------------------
{
  const name = 'Owner approves without a rate (directly, and with approve_employee)'
  const direct = await owner.client.from('employees').update({ status: 'approved' }).eq('id', pendingPerson.id).select('id')
  const viaFunction = await owner.client.rpc('approve_employee', {
    p_employee_id: pendingPerson.id,
    p_hourly_rate: null,
    p_effective_from: PENDING_DAY,
  })
  const after = await readPerson(pendingPerson.id)
  const ok = direct.error?.code === '23514' && viaFunction.error?.code === '23514' && after?.status === 'pending'
  record(
    name,
    ok,
    ok
      ? 'Refused both ways; still Pending.'
      : `Direct: ${direct.error?.message ?? 'no error'}; function: ${viaFunction.error?.message ?? 'no error'}; status ${after?.status}.`,
  )
  covers('employees_before_write', 'approve_employee')
}

{
  const name = 'Owner rejects without a reason'
  const { error } = await owner.client.from('employees').update({ status: 'inactive' }).eq('id', pendingPerson.id).select('id')
  const after = await readPerson(pendingPerson.id)
  const ok = error?.code === '23514' && after?.status === 'pending'
  record(name, ok, ok ? 'Refused; still Pending.' : `Error: ${error?.message ?? 'none'}; status ${after?.status}.`)
  covers('employees_before_write')
}

{
  const name = "Owner approves with a rate (the app's way): the 4 h are now priced at R400"
  try {
    await approveEmployee(owner.client, pendingPerson.id, 100, PENDING_DAY)
    const after = await readPerson(pendingPerson.id)
    const costs = await pendingProjectCosts()
    const ok =
      after?.status === 'approved' &&
      after.approved_by === owner.userId &&
      costs.spent === 400 &&
      costs.unpriced === 0
    record(
      name,
      ok,
      ok ? 'Approved and stamped; R400 spent, 0 h unpriced.' : `Status ${after?.status}; spent ${rand(costs.spent)}; ${costs.unpriced} h unpriced.`,
    )
  } catch (error) {
    record(name, false, `Could not approve: ${error.message}`)
  }
  covers('approve_employee', 'rate_on', 'employees_before_write')
}

await attackUpdate(
  'Site manager renames the person after they were approved',
  site,
  owner,
  'employees',
  pendingPerson.id,
  { full_name: 'HACKED' },
  'full_name',
)
covers('employees_before_write')

{
  const name = "Owner rejects a new person with a reason (the app's way)"
  try {
    const second = await addEmployee(site.client, { fullName: `ZZ Pending Reject ${RUN_TAG}`, category: 'general_worker' })
    await rejectEmployee(owner.client, second.id, 'RLS test: duplicate')
    const after = await readPerson(second.id)
    const ok =
      after?.status === 'inactive' &&
      Boolean(after.rejected_at) &&
      after.reject_reason === 'RLS test: duplicate' &&
      after.approved_at === null
    record(name, ok, ok ? 'Inactive, with the reason and when it was rejected.' : `Got: ${JSON.stringify(after)}`)
  } catch (error) {
    record(name, false, `Error: ${error.message}`)
  }
  covers('employees_before_write')
}

// --- Finish off this run's test data (nothing can be deleted) -------------------
{
  const outcomes = await Promise.all([
    owner.client.from('employees').update({ status: 'inactive' }).eq('id', pendingPerson.id).select('id'),
    owner.client.from('projects').update({ status: 'complete' }).eq('id', pendingProjectId).select('id'),
  ])
  const failed = outcomes.find((outcome) => outcome.error)
  if (failed) console.log(`          (note: tidy-up incomplete: ${failed.error.message})`)
}

// =============================================================================
// Overtime (phase 8A-1)
// =============================================================================
// Pay is worked out per person per DAY across all reports and projects:
// up to 8 h ordinary, the rest overtime at x1.5, at the rate on that day,
// then shared between projects by their share of the day's hours. Its own
// projects, people and dates. The switched-off rules (weekly, Sunday,
// public holiday) are proven in a 2099 test week with a temporary rule that
// is voided afterwards - real dates are never touched.
console.log('\nOvertime attacks and sums…\n')

const OT_PREFIX = 'ZZ Overtime Test'
const OT_MON = '2026-05-04' // a Monday
const OT_WED = '2026-05-06'
const OT_THU = '2026-05-07'
const TEST_RULE_FROM = '2099-01-01'
const WEEK_2099 = ['2099-03-02', '2099-03-03', '2099-03-04', '2099-03-05', '2099-03-06', '2099-03-07'] // Mon-Sat
const HOLIDAY_2099 = '2099-03-10' // a Tuesday
const SUNDAY_2099 = '2099-03-15'
const R100 = { hourly_rate: 100, effective_from: '2026-01-01' }

// Finish off what an interrupted run left behind: projects, and a live 2099
// test rule or test holiday.
{
  const results = await Promise.all([
    owner.client.from('projects').update({ status: 'complete' }).like('name', `${OT_PREFIX}%`).eq('status', 'active'),
    owner.client
      .from('pay_rules')
      .update({ void_reason: 'RLS test: tidy-up' })
      .eq('effective_from', TEST_RULE_FROM)
      .is('voided_at', null),
    owner.client
      .from('public_holidays')
      .update({ void_reason: 'RLS test: tidy-up' })
      .eq('holiday_date', HOLIDAY_2099)
      .is('voided_at', null),
  ])
  const failed = results.find((result) => result.error)
  if (failed) stop(`owner could not tidy up old overtime test data: ${failed.error.message}`)
}

// --- Site manager: pay rules and the overtime views are owner-only ------------
await attackReadNothing('Site manager reads pay_rules', site.client, 'pay_rules')
await attackReadNothing('Site manager reads public_holidays', site.client, 'public_holidays')
await attackReadNothing('Site manager reads labour_days (pay per person per day)', site.client, 'labour_days')
await attackReadNothing('Site manager reads labour_lines (pay per report line)', site.client, 'labour_lines')
covers('pay_rules', 'public_holidays', 'labour_days', 'labour_lines')
await attackInsert('Site manager adds a pay rule', site.client, 'pay_rules', { effective_from: '2030-01-01', ot_multiplier: 3 })
await attackInsert('Site manager adds a public holiday', site.client, 'public_holidays', { holiday_date: '2030-01-02', name: 'Attack' })
covers('pay_rules', 'public_holidays')
{
  const { data: seed } = await owner.client
    .from('pay_rules')
    .select('id')
    .eq('effective_from', '2000-01-01')
    .is('voided_at', null)
    .maybeSingle()
  if (!seed) stop('the overtime checks need the first pay rule (from 1 Jan 2000) - run the 8A-1 migration first.')
  await attackUpdate('Site manager voids the pay rule in force', site, owner, 'pay_rules', seed.id, { void_reason: 'attack' }, 'void_reason')
  await attackUpdate('Owner edits a pay rule (rules are never edited)', owner, owner, 'pay_rules', seed.id, { ot_multiplier: 3 }, 'ot_multiplier')
  covers('pay_rules', 'pay_rules_before_write')
}
for (const fn of ['pay_rules_before_write', 'public_holidays_before_write']) {
  const name = `Site manager calls the trigger function ${fn}() directly`
  const { error } = await site.client.rpc(fn, {})
  record(name, Boolean(error), error ? `Refused: ${error.message}` : 'BREACH: it ran.')
  covers(fn)
}

// --- Owner, at R100/h ------------------------------------------------------------
const otProjectA = await ownerInsert('projects', { name: `${OT_PREFIX} A ${RUN_TAG}`, status: 'active' }, 'overtime test project A')
const otProjectB = await ownerInsert('projects', { name: `${OT_PREFIX} B ${RUN_TAG}`, status: 'active' }, 'overtime test project B')
const splitPerson = await createTestPerson(`ZZ OT Split ${RUN_TAG}`, { rate: R100 })
const eightPerson = await createTestPerson(`ZZ OT Eight ${RUN_TAG}`, { rate: R100 })
const raisePerson = await createTestPerson(`ZZ OT Raise ${RUN_TAG}`, { rate: R100 })
await ownerInsert('employee_rates', { employee_id: raisePerson, hourly_rate: 120, effective_from: OT_THU }, 'the R120 rate from Thursday')
const weekPerson = await createTestPerson(`ZZ OT Week ${RUN_TAG}`, { rate: R100 })
const premiumPerson = await createTestPerson(`ZZ OT Premium ${RUN_TAG}`, { rate: R100 })

// A submitted report by site manager 1.
async function otReport(projectId, date, crew) {
  const { data: reportId, error } = await site.client.rpc('save_report_draft', {
    p_report: { project_id: projectId, report_date: date, activities: `RLS overtime test ${RUN_TAG}` },
    p_crew: crew,
    p_equipment: [],
  })
  if (error) stop(`site manager 1 could not save an overtime test report: ${error.message}`)
  const { data, error: submitError } = await site.client
    .from('daily_reports')
    .update({ status: 'submitted' })
    .eq('id', reportId)
    .select('id')
  if (submitError || data.length !== 1) stop(`site manager 1 could not submit an overtime test report: ${submitError?.message}`)
  return reportId
}

await otReport(otProjectA, OT_MON, [
  { employee_id: splitPerson, hours: 6 },
  { employee_id: eightPerson, hours: 8 },
])
await otReport(otProjectB, OT_MON, [{ employee_id: splitPerson, hours: 4 }])
await otReport(otProjectA, OT_WED, [{ employee_id: raisePerson, hours: 10 }])
await otReport(otProjectA, OT_THU, [{ employee_id: raisePerson, hours: 10 }])

// The owner's view of one person's day (labour_days).
async function payDay(employeeId, day) {
  const { data, error } = await owner.client
    .from('labour_days')
    .select('total_hours, rate, ordinary_hours, ot_hours, premium_hours, premium_kind, ordinary_pay, ot_pay, premium_pay, total_pay')
    .eq('employee_id', employeeId)
    .eq('day', day)
    .maybeSingle()
  if (error) throw error
  return data
}
// What one project was charged for one person on one day (project_cost_lines).
async function projectCharge(projectId, employeeId, day) {
  const { data, error } = await owner.client
    .from('project_cost_lines')
    .select('hours, ordinary_hours, ot_hours, amount, ot_amount')
    .eq('project_id', projectId)
    .eq('employee_id', employeeId)
    .eq('cost_date', day)
  if (error) throw error
  return data
}

{
  const name = 'Overtime: 6 h on project A + 4 h on project B the same day = R1,100; A R660, B R440'
  try {
    const day = await payDay(splitPerson, OT_MON)
    const [a] = await projectCharge(otProjectA, splitPerson, OT_MON)
    const [b] = await projectCharge(otProjectB, splitPerson, OT_MON)
    const ok =
      Number(day?.total_hours) === 10 &&
      Number(day.ordinary_hours) === 8 &&
      Number(day.ot_hours) === 2 &&
      Number(day.total_pay) === 1100 &&
      Number(a?.amount) === 660 &&
      Number(a.ot_hours) === 1.2 &&
      Number(b?.amount) === 440 &&
      Number(b.ot_hours) === 0.8
    record(
      name,
      ok,
      ok
        ? 'Day: 8 h x R100 + 2 h x R150 = R1,100. A (6 h) R660 incl. 1.2 h overtime; B (4 h) R440 incl. 0.8 h.'
        : `Day: ${JSON.stringify(day)}; A: ${JSON.stringify(a)}; B: ${JSON.stringify(b)}`,
    )
  } catch (error) {
    record(name, false, `Error: ${error.message}`)
  }
  covers('labour_days', 'labour_lines', 'project_cost_lines')
}

{
  const name = 'Overtime: exactly 8 h = R800, no overtime'
  try {
    const day = await payDay(eightPerson, OT_MON)
    const ok = Number(day?.total_pay) === 800 && Number(day.ot_hours) === 0 && Number(day.ot_pay) === 0
    record(name, ok, ok ? '8 h x R100 = R800; 0 h overtime.' : `Got: ${JSON.stringify(day)}`)
  } catch (error) {
    record(name, false, `Error: ${error.message}`)
  }
  covers('labour_days')
}

{
  const name = 'Overtime: R100 until Wednesday, R120 from Thursday; 10 h on Thursday = R1,320'
  try {
    const wednesday = await payDay(raisePerson, OT_WED)
    const thursday = await payDay(raisePerson, OT_THU)
    const ok =
      Number(wednesday?.rate) === 100 &&
      Number(wednesday.total_pay) === 1100 &&
      Number(thursday?.rate) === 120 &&
      Number(thursday.ordinary_pay) === 960 &&
      Number(thursday.ot_pay) === 360 &&
      Number(thursday.total_pay) === 1320
    record(
      name,
      ok,
      ok ? 'Wednesday at R100: R1,100. Thursday at R120: 8 x R120 + 2 x R180 = R1,320.' : `Wed: ${JSON.stringify(wednesday)}; Thu: ${JSON.stringify(thursday)}`,
    )
  } catch (error) {
    record(name, false, `Error: ${error.message}`)
  }
  covers('labour_days', 'rate_on')
}

// --- The switched-off rules, in a 2099 test week -------------------------------
let testRuleId = null
let testHolidayId = null
{
  const name = 'Owner adds a dated pay rule and a public holiday (2099 test week)'
  const rule = await owner.client
    .from('pay_rules')
    .insert({ effective_from: TEST_RULE_FROM, weekly_ot_enabled: true, sunday_enabled: true, public_holiday_enabled: true })
    .select('id, created_by')
    .single()
  const holiday = await owner.client
    .from('public_holidays')
    .insert({ holiday_date: HOLIDAY_2099, name: `RLS test holiday ${RUN_TAG}` })
    .select('id')
    .single()
  testRuleId = rule.data?.id ?? null
  testHolidayId = holiday.data?.id ?? null
  const failed = rule.error ?? holiday.error
  if (failed) record(name, false, `Error: ${failed.message}`)
  else record(name, rule.data.created_by === owner.userId, 'Added; the rule records who added it.')
  covers('pay_rules', 'public_holidays', 'pay_rules_before_write', 'public_holidays_before_write')
}
if (!testRuleId || !testHolidayId) stop('the 2099 checks need the test rule and holiday')

for (const day of WEEK_2099) await otReport(otProjectA, day, [{ employee_id: weekPerson, hours: 8 }])
await otReport(otProjectA, HOLIDAY_2099, [{ employee_id: premiumPerson, hours: 8 }])
await otReport(otProjectA, SUNDAY_2099, [{ employee_id: premiumPerson, hours: 5 }])

{
  const name = 'Public holiday rule (when ON): 8 h on a holiday at x2.0 = R1,600'
  try {
    const day = await payDay(premiumPerson, HOLIDAY_2099)
    const ok = day?.premium_kind === 'public_holiday' && Number(day.premium_hours) === 8 && Number(day.total_pay) === 1600 && Number(day.ot_hours) === 0
    record(name, ok, ok ? '8 h x R100 x 2.0 = R1,600.' : `Got: ${JSON.stringify(day)}`)
  } catch (error) {
    record(name, false, `Error: ${error.message}`)
  }
  covers('labour_days', 'public_holidays')
}

{
  const name = 'Sunday rule (when ON): 5 h on a Sunday at x2.0 = R1,000'
  try {
    const day = await payDay(premiumPerson, SUNDAY_2099)
    const ok = day?.premium_kind === 'sunday' && Number(day.premium_hours) === 5 && Number(day.total_pay) === 1000
    record(name, ok, ok ? '5 h x R100 x 2.0 = R1,000.' : `Got: ${JSON.stringify(day)}`)
  } catch (error) {
    record(name, false, `Error: ${error.message}`)
  }
  covers('labour_days', 'pay_rules')
}

{
  const name = 'Weekly rule (when ON): 8 h Mon-Sat = 48 h; 3 h over 45 become overtime on Saturday (R950)'
  try {
    const days = await Promise.all(WEEK_2099.map((day) => payDay(weekPerson, day)))
    const saturday = days.at(-1)
    const weekdays = days.slice(0, -1)
    const ok =
      weekdays.every((day) => Number(day?.total_pay) === 800 && Number(day.ot_hours) === 0) &&
      Number(saturday?.ordinary_hours) === 5 &&
      Number(saturday.ot_hours) === 3 &&
      Number(saturday.total_pay) === 950
    record(name, ok, ok ? 'Mon-Fri R800 each; Saturday 5 h x R100 + 3 h x R150 = R950.' : `Got: ${JSON.stringify(days)}`)
  } catch (error) {
    record(name, false, `Error: ${error.message}`)
  }
  covers('labour_days', 'pay_rules')
}

{
  const name = 'Owner voids a pay rule without a reason'
  const { error } = await owner.client.from('pay_rules').update({ void_reason: ' ' }).eq('id', testRuleId).select('id')
  record(name, error?.code === '23514', error ? `Refused: ${error.message}` : 'BREACH: voided without a reason.')
  covers('pay_rules_before_write')
}

{
  const name = 'Voiding the 2099 rule and holiday puts those days back on the rule in force (Saturday R800)'
  const results = await Promise.all([
    owner.client.from('pay_rules').update({ void_reason: 'RLS test: done' }).eq('id', testRuleId).select('voided_at'),
    owner.client.from('public_holidays').update({ void_reason: 'RLS test: done' }).eq('id', testHolidayId).select('voided_at'),
  ])
  const failed = results.find((result) => result.error)
  try {
    if (failed) throw failed.error
    const saturday = await payDay(weekPerson, WEEK_2099.at(-1))
    const holiday = await payDay(premiumPerson, HOLIDAY_2099)
    const ok =
      results.every((result) => result.data?.[0]?.voided_at) &&
      Number(saturday?.total_pay) === 800 &&
      holiday?.premium_kind === null &&
      Number(holiday.total_pay) === 800
    record(name, ok, ok ? 'Voided (kept in history); Saturday back to R800, the holiday back to a normal R800 day.' : `Saturday: ${JSON.stringify(saturday)}; holiday: ${JSON.stringify(holiday)}`)
  } catch (error) {
    record(name, false, `Error: ${error.message}`)
  }
  covers('pay_rules', 'public_holidays', 'labour_days')
}

// =============================================================================
// Exports: the project filter
// =============================================================================
// 8A's split person worked 6 h on project A + 4 h on project B on OT_MON at
// R100/h: R1,100 for the day (8 h + 2 h overtime). Filtered to projects,
// the pay exports give only those projects' share - a PROJECT LABOUR COST
// ALLOCATION: A R660, B R440. The 8-hour person is on A only (R800).
console.log('\nExport project filter…\n')

const otA = { id: otProjectA, name: `${OT_PREFIX} A ${RUN_TAG}` }
const otB = { id: otProjectB, name: `${OT_PREFIX} B ${RUN_TAG}` }
const splitName = `ZZ OT Split ${RUN_TAG}`
const fileSlug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
const otDayArgs = (projects) => ({ p_project_ids: projects ? projects.map((p) => p.id) : null, p_from: OT_MON, p_to: OT_MON })

// The owner's payroll rows for OT_MON (projects null = all projects).
async function payrollRows(projects) {
  const { data, error } = await owner.client.rpc('export_payroll', otDayArgs(projects))
  if (error) throw error
  return data
}
const splitRowOf = (rows) => rows.find((row) => row.employee_id === splitPerson)

// A cell on a built sheet: the row whose first cell is `label` (and whose
// Project column is `project`, if given), under `header` on the sheet's
// header row. Returns { value, formula }.
function cellAt(workbook, sheetName, label, header, project) {
  const sheet = workbook.getWorksheet(sheetName)
  if (!sheet) return { value: null, formula: null }
  const headerRow = sheet.getRow(sheet.views[0].ySplit)
  const columnOfHeader = (text) => {
    let found = null
    headerRow.eachCell((cell, column) => {
      if (!found && cell.value === text) found = column
    })
    return found
  }
  const column = columnOfHeader(header)
  const projectColumn = project ? columnOfHeader('Project') : null
  let cell = null
  sheet.eachRow((row, number) => {
    if (number <= headerRow.number || row.getCell(1).value !== label) return
    if (project && row.getCell(projectColumn).value !== project) return
    cell = row.getCell(column)
  })
  const value = cell?.value
  return {
    value: value === null || value === undefined ? null : Number(value.result ?? value),
    formula: value?.formula ?? null,
  }
}
// Every line of text in a sheet's first column.
const firstColumn = (workbook, sheetName) => {
  const lines = []
  workbook.getWorksheet(sheetName)?.eachRow((row) => lines.push(row.getCell(1).value))
  return lines
}

let filteredA = []
let filteredB = []
{
  const name = 'Export filter: payroll filtered to A = R660, to B = R440, all projects = R1,100; A + B = all projects'
  try {
    let unfiltered
    ;[filteredA, filteredB, unfiltered] = await Promise.all([payrollRows([otA]), payrollRows([otB]), payrollRows(null)])
    const a = splitRowOf(filteredA)
    const b = splitRowOf(filteredB)
    const all = splitRowOf(unfiltered)
    const ok =
      Number(a?.gross) === 660 &&
      Number(a.ordinary_pay) === 480 &&
      Number(a.ot_hours) === 1.2 &&
      Number(a.ot_pay) === 180 &&
      a.project_id === otProjectA &&
      Number(b?.gross) === 440 &&
      Number(b.ot_hours) === 0.8 &&
      Number(b.ot_pay) === 120 &&
      b.project_id === otProjectB &&
      Number(all?.gross) === 1100 &&
      Number(all.ot_pay) === 300 &&
      all.project_id === null &&
      all.project_name === `${otA.name}, ${otB.name}` &&
      Number(a.gross) + Number(b.gross) === Number(all.gross) &&
      filteredA.every((row) => row.project_id === otProjectA) &&
      filteredB.every((row) => row.project_id === otProjectB)
    record(
      name,
      ok,
      ok
        ? 'A: R660 (4.8 h R480 + 1.2 h overtime R180). B: R440 (0.8 h overtime R120). All projects: R1,100 on one row, both projects named. R660 + R440 = R1,100.'
        : `A: ${JSON.stringify(a)}; B: ${JSON.stringify(b)}; all: ${JSON.stringify(all)}`,
    )
  } catch (error) {
    record(name, false, `Error: ${error.message}`)
  }
  covers('export_payroll', 'export_labour')
}

{
  const name = 'Export filter: each figure equals the dashboard drill-down for the same filter'
  try {
    const drill = async (projectId) => {
      const { data, error } = await owner.client.rpc('drill_hours', {
        p_project_id: projectId,
        p_from: OT_MON,
        p_to: OT_MON,
        p_category: 'labour',
      })
      if (error) throw error
      return data.find((row) => row.who_id === splitPerson)
    }
    const labour = async (projects) => {
      const { data, error } = await owner.client.rpc('export_labour', otDayArgs(projects))
      if (error) throw error
      return splitRowOf(data)
    }
    const pairs = await Promise.all(
      [[otA], [otB], null].map(async (projects) => [await labour(projects), await drill(projects?.[0].id ?? null)]),
    )
    const ok = pairs.every(
      ([exported, drilled]) =>
        exported &&
        drilled &&
        Number(exported.cost) === Number(drilled.cost) &&
        Number(exported.ot_pay) === Number(drilled.ot_pay) &&
        Number(exported.hours) === Number(drilled.hours),
    )
    record(
      name,
      ok,
      ok
        ? 'A R660, B R440, all projects R1,100 - the export and the drill-down agree (cost, overtime and hours).'
        : `Got: ${JSON.stringify(pairs.map(([e, d]) => [e?.cost, d?.cost]))}`,
    )
  } catch (error) {
    record(name, false, `Error: ${error.message}`)
  }
  covers('export_labour', 'drill_hours')
}

{
  const name = "Export filter (the app's own file): A + B = PROJECT LABOUR COST ALLOCATION, a subtotal per project, then the grand total"
  try {
    const projects = [otA, otB]
    const data = await fetchPayrollHours(owner.client, { projects, from: OT_MON, to: OT_MON })
    const { workbook, filename } = buildPayrollHours(data, { ...exportMeta, projects, from: OT_MON, to: OT_MON })
    const SHEET = 'Labour allocation'
    const MONEY_COLUMN = 'Allocated labour cost'
    const lines = firstColumn(workbook, SHEET)
    const subA = cellAt(workbook, SHEET, `Subtotal: ${otA.name}`, MONEY_COLUMN)
    const subB = cellAt(workbook, SHEET, `Subtotal: ${otB.name}`, MONEY_COLUMN)
    const total = cellAt(workbook, SHEET, 'Total', MONEY_COLUMN)
    const dbTotal = Number(data.people[0]?.total_gross)
    const aOnlyTotal = Number(filteredA[0]?.total_gross)
    const bOnlyTotal = Number(filteredB[0]?.total_gross)
    const expectedName = `nkutwala_labour-allocation_${fileSlug(otA.name)}+${fileSlug(otB.name)}_${OT_MON}_${OT_MON}.xlsx`
    const problems = [
      lines[0] === ALLOCATION_TITLE ? null : `Top line: ${lines[0]}`,
      lines.includes(PAY_ONLY_UNFILTERED) ? null : 'No "pay only from the unfiltered pay run" note',
      workbook.worksheets.map((sheet) => sheet.name).join(', ') === 'Labour allocation, Daily grid, Excluded' ? null : 'Sheets',
      cellAt(workbook, SHEET, splitName, MONEY_COLUMN, otA.name).value === 660 ? null : 'Split person on A is not R660',
      cellAt(workbook, SHEET, splitName, MONEY_COLUMN, otB.name).value === 440 ? null : 'Split person on B is not R440',
      cellAt(workbook, SHEET, splitName, 'Overtime pay', otA.name).value === 180 ? null : 'A overtime is not R180',
      subA.value === 1460 && subA.formula?.startsWith('SUM(') ? null : `Subtotal A: ${JSON.stringify(subA)}`,
      subB.value === 440 && subB.formula?.startsWith('SUM(') ? null : `Subtotal B: ${JSON.stringify(subB)}`,
      total.value === 1900 && total.formula?.includes('+') ? null : `Total: ${JSON.stringify(total)}`,
      dbTotal === 1900 && dbTotal === aOnlyTotal + bOnlyTotal ? null : `Database totals: A+B ${dbTotal}, A ${aOnlyTotal}, B ${bOnlyTotal}`,
      cellAt(workbook, 'Daily grid', `Subtotal: ${otA.name}`, 'Total hours').value === 14 ? null : 'Daily grid subtotal A is not 14 h',
      filename === expectedName ? null : `File name ${filename}`,
    ].filter(Boolean)
    record(
      name,
      problems.length === 0,
      problems.length
        ? problems.join('; ')
        : 'Allocation title and "pay only from the unfiltered pay run"; split person A R660 / B R440; subtotals A R1,460, B R440; total R1,900 = the database = A alone + B alone.',
    )
  } catch (error) {
    record(name, false, `Could not build it: ${error.message}`)
  }
  covers('export_payroll', 'export_daily_hours')
}

{
  const name = "Export filter (the app's own file): all projects = GROSS BEFORE DEDUCTIONS — NOT A PAYSLIP, the split person on one row at R1,100"
  try {
    const data = await fetchPayrollHours(owner.client, { projects: null, from: OT_MON, to: OT_MON })
    const { workbook, filename } = buildPayrollHours(data, { ...exportMeta, projects: null, from: OT_MON, to: OT_MON })
    const lines = firstColumn(workbook, 'Payroll hours')
    const projectsWorked = (() => {
      const sheet = workbook.getWorksheet('Payroll hours')
      let found = null
      sheet.eachRow((row) => {
        if (row.getCell(1).value === splitName) found = row.getCell(2).value
      })
      return found
    })()
    const problems = [
      lines[0] === PAY_TITLE ? null : `Top line: ${lines[0]}`,
      lines.includes(PAY_ONLY_UNFILTERED) ? null : 'No "pay only from the unfiltered pay run" note',
      lines.filter((line) => line === splitName).length === 1 ? null : 'The split person is not on exactly one row',
      cellAt(workbook, 'Payroll hours', splitName, 'Gross (provisional)').value === 1100 ? null : 'Split person gross is not R1,100',
      projectsWorked === `${otA.name}, ${otB.name}` ? null : `Projects worked: ${projectsWorked}`,
      filename === `nkutwala_payroll-hours_all-projects_${OT_MON}_${OT_MON}.xlsx` ? null : `File name ${filename}`,
    ].filter(Boolean)
    record(name, problems.length === 0, problems.length ? problems.join('; ') : 'Full-pay title, the payment note; R1,100 on one row with both projects listed; all-projects file name.')
  } catch (error) {
    record(name, false, `Could not build it: ${error.message}`)
  }
  covers('export_payroll', 'export_daily_hours')
}

{
  const name = "Export filter (the app's own file): cost report for A + B - a subtotal per project, each equal to that project's dashboard"
  try {
    const projects = [otA, otB]
    const data = await fetchProjectCost(owner.client, { projects, from: OT_MON, to: OT_MON })
    const { workbook, filename } = buildProjectCost(data, { ...exportMeta, projects, from: OT_MON, to: OT_MON })
    const dashboard = async (projectId) => {
      const { data: rows, error } = await owner.client.rpc('dashboard_summary', { p_project_id: projectId, p_from: OT_MON, p_to: OT_MON })
      if (error) throw error
      return Number(rows[0]?.spent)
    }
    const [dashA, dashB] = await Promise.all([dashboard(otProjectA), dashboard(otProjectB)])
    const problems = [
      cellAt(workbook, 'Labour', `Subtotal: ${otA.name}`, 'Cost (provisional)').value === 1460 ? null : 'Labour subtotal A is not R1,460',
      cellAt(workbook, 'Labour', `Subtotal: ${otB.name}`, 'Cost (provisional)').value === 440 ? null : 'Labour subtotal B is not R440',
      cellAt(workbook, 'Labour', 'Total', 'Cost (provisional)').value === 1900 ? null : 'Labour total is not R1,900',
      cellAt(workbook, 'Labour', splitName, 'Cost (provisional)', otA.name).value === 660 ? null : 'Split person on A is not R660',
      cellAt(workbook, 'Summary', `Subtotal: ${otA.name}`, 'Spent in period').value === dashA && dashA === 1460
        ? null
        : `Summary A vs dashboard ${dashA}`,
      cellAt(workbook, 'Summary', `Subtotal: ${otB.name}`, 'Spent in period').value === dashB && dashB === 440
        ? null
        : `Summary B vs dashboard ${dashB}`,
      cellAt(workbook, 'Summary', 'Total', 'Spent in period').value === 1900 ? null : 'Summary total is not R1,900',
      cellAt(workbook, 'By week', 'Total', 'Total').value === 1900 ? null : 'By week total is not R1,900',
      filename === `nkutwala_project-cost_${fileSlug(otA.name)}+${fileSlug(otB.name)}_${OT_MON}_${OT_MON}.xlsx` ? null : `File name ${filename}`,
    ].filter(Boolean)
    record(
      name,
      problems.length === 0,
      problems.length ? problems.join('; ') : 'Labour: A R1,460, B R440, total R1,900. Summary subtotals = each project\'s dashboard. By week total R1,900.',
    )
  } catch (error) {
    record(name, false, `Could not build it: ${error.message}`)
  }
  covers('export_cost_summary', 'export_labour', 'export_receipts', 'export_weekly', 'dashboard_categories', 'dashboard_weekly_mix')
}

{
  const name = 'Owner: "To date" for chosen projects starts at their first cost'
  const { data, error } = await owner.client.rpc('export_period', { p_preset: 'project_to_date', p_project_ids: [otProjectA, otProjectB] })
  if (error) record(name, false, `Error: ${error.message}`)
  else record(name, data?.[0]?.from_date === OT_MON, `Got: ${JSON.stringify(data)}`)
  covers('export_period', 'dashboard_period')
}

{
  const name = 'Export log records the projects chosen (ids and names) and that it was an allocation'
  const marker = `rls-filter-${RUN_TAG}`
  const filters = { ...exportLogFilters({ projects: [otA, otB], from: OT_MON, to: OT_MON, allocation: true }), marker }
  const { error } = await owner.client.from('export_log').insert({ report_type: 'payroll_hours', filters })
  const { data } = await owner.client.from('export_log').select('user_id, filters').eq('filters->>marker', marker)
  const got = data?.[0]?.filters
  const all = exportLogFilters({ projects: null, from: OT_MON, to: OT_MON })
  const ok =
    !error &&
    data?.length === 1 &&
    data[0].user_id === owner.userId &&
    JSON.stringify(got.project_ids) === JSON.stringify([otProjectA, otProjectB]) &&
    JSON.stringify(got.project_names) === JSON.stringify([otA.name, otB.name]) &&
    got.projects === `${otA.name}, ${otB.name}` &&
    got.allocation === true &&
    all.project_ids === null &&
    all.projects === 'All projects'
  record(name, ok, ok ? 'Logged: both project ids and names, "allocation"; all projects logged as "All projects".' : `Error: ${error?.message}; got ${JSON.stringify(data)}`)
  covers('export_log')
}

// --- Site managers: their own reports' projects only, quantities only ------------
{
  const name = 'Site manager 2 asks for a labour return on a project they have no reports on: nothing comes back'
  const [labourReturn, theirProjects] = await Promise.all([
    site2.client.rpc('my_labour_return', otDayArgs([otA])),
    site2.client.rpc('my_report_projects'),
  ])
  const error = labourReturn.error ?? theirProjects.error
  const ok =
    !error &&
    labourReturn.data.length === 0 &&
    !theirProjects.data.some((row) => row.project_id === otProjectA || row.project_id === otProjectB)
  record(
    name,
    ok,
    error ? `Error: ${error.message}` : ok ? 'Nothing returned; project A is not in their project list.' : `LEAK: ${JSON.stringify(labourReturn.data).slice(0, 200)}`,
  )
  covers('my_labour_return', 'my_report_projects')
}
{
  const name = 'Owner asks my_labour_return for project A: nothing (only the caller\'s OWN reports, even for an owner)'
  const { data, error } = await owner.client.rpc('my_labour_return', otDayArgs([otA]))
  record(name, !error && data.length === 0, error ? `Error: ${error.message}` : `${data.length} rows.`)
  covers('my_labour_return')
}
{
  const name = 'Site manager 1: their labour return for project A - their hours, and not one money column'
  const ALLOWED = [
    'project_id',
    'project_name',
    'report_id',
    'report_date',
    'employee_id',
    'full_name',
    'category',
    'hours',
    'project_total_hours',
    'total_hours',
  ]
  const [labourReturn, theirProjects] = await Promise.all([
    site.client.rpc('my_labour_return', otDayArgs([otA])),
    site.client.rpc('my_report_projects'),
  ])
  const error = labourReturn.error ?? theirProjects.error
  const rows = labourReturn.data ?? []
  const split = rows.find((row) => row.employee_id === splitPerson)
  const extraKeys = [...new Set(rows.flatMap((row) => Object.keys(row)))].filter((key) => !ALLOWED.includes(key))
  const ok =
    !error &&
    rows.length === 2 &&
    rows.every((row) => row.project_id === otProjectA) &&
    Number(split?.hours) === 6 &&
    Number(rows[0].total_hours) === 14 &&
    extraKeys.length === 0 &&
    theirProjects.data.some((row) => row.project_id === otProjectA)
  record(
    name,
    ok,
    error
      ? `Error: ${error.message}`
      : ok
        ? 'Split 6 h, 8-hour person 8 h, total 14 h - names and hours only. Project A is in their list.'
        : `Rows: ${JSON.stringify(rows).slice(0, 300)}; extra columns: ${extraKeys.join(', ')}`,
  )
  covers('my_labour_return', 'my_report_projects')
}
// Site manager 1 asks the OWNER's export functions about projects A and B
// (their own reports): nothing.
for (const fn of ['export_payroll', 'export_labour', 'export_cost_summary', 'export_daily_hours', 'export_receipts', 'export_weekly']) {
  const name = `Site manager calls ${fn}() for projects A + B (their own reports)`
  const { data, error } = await site.client.rpc(fn, otDayArgs([otA, otB]))
  if (error?.code === PERMISSION_DENIED) record(name, true, 'Server refused (permission denied).')
  else if (error) record(name, false, `Unexpected error: ${error.message}`)
  else if (data.length > 0) record(name, false, `LEAK: ${JSON.stringify(data).slice(0, 200)}`)
  else record(name, true, 'Nothing came back.')
  covers(fn)
}

// --- Finish off this run's overtime test data (nothing can be deleted) ---------
{
  const outcomes = await Promise.all([
    owner.client.from('projects').update({ status: 'complete' }).in('id', [otProjectA, otProjectB]).select('id'),
  ])
  const failed = outcomes.find((outcome) => outcome.error)
  if (failed) console.log(`          (note: tidy-up incomplete: ${failed.error.message})`)
}

// =============================================================================
// Pay periods and pay runs (phase 8B-1)
// =============================================================================
// Pay periods are company-wide, never deleted and can never overlap, so the
// test uses its own 2001+ "test window": each run takes the next free 14 days
// after the previous run's (and the 14 after that for the late-hours check).
// Real dates and the other tests' dates (2026, 2099) are never touched.
console.log('\nPay period and pay run attacks…\n')

const PAY_PREFIX = 'ZZ Pay Run Test'
const PAY_WINDOW_END = '2020-01-01'
let payStart
{
  const { data, error } = await owner.client
    .from('pay_periods')
    .select('end_date')
    .lt('end_date', PAY_WINDOW_END)
    .order('end_date', { ascending: false })
    .limit(1)
  if (error) stop(`the pay run checks need pay_periods - run the 8B-1 migration first (${error.message})`)
  payStart = data.length ? shiftDate(data[0].end_date, 1) : '2001-01-01'
}
const payEnd = shiftDate(payStart, 13)
const PAY_D1 = shiftDate(payStart, 1)
const PAY_D2 = shiftDate(payStart, 2)
const PAY_D3 = shiftDate(payStart, 3)
const PAY_D4 = shiftDate(payStart, 4)
const fromPeriodStart = { hourly_rate: 100, effective_from: payStart }

// Finish off a project an interrupted run left active.
{
  const { error } = await owner.client
    .from('projects')
    .update({ status: 'complete' })
    .like('name', `${PAY_PREFIX}%`)
    .eq('status', 'active')
  if (error) stop(`owner could not tidy up old pay run test projects: ${error.message}`)
}

const payProject = await ownerInsert('projects', { name: `${PAY_PREFIX} ${RUN_TAG}`, status: 'active' }, 'the pay run test project')
const payA = await createTestPerson(`ZZ Pay A ${RUN_TAG}`, { rate: fromPeriodStart })
const payB = await createTestPerson(`ZZ Pay B ${RUN_TAG}`, { rate: fromPeriodStart })
// Approved, but the rate only starts after the hours below: unpriced.
const payC = await createTestPerson(`ZZ Pay C ${RUN_TAG}`, { rate: { hourly_rate: 100, effective_from: shiftDate(payStart, 20) } })
// Added by site manager 1: pending (no rate) - left out, paid later.
let payD = null
try {
  payD = await addEmployee(site.client, { fullName: `ZZ Pay D ${RUN_TAG}`, category: 'general_worker' })
} catch (error) {
  stop(`site manager 1 could not add the pending pay run test person: ${error.message}`)
}

// A report by site manager 1 (submitted unless asked not to).
async function payReport(date, crew, { submit = true } = {}) {
  const { data: reportId, error } = await site.client.rpc('save_report_draft', {
    p_report: { project_id: payProject, report_date: date, activities: `RLS pay run test ${RUN_TAG}` },
    p_crew: crew,
    p_equipment: [],
  })
  if (error) stop(`site manager 1 could not save a pay run test report: ${error.message}`)
  if (submit) {
    const { data, error: submitError } = await site.client
      .from('daily_reports')
      .update({ status: 'submitted' })
      .eq('id', reportId)
      .select('id')
    if (submitError || data.length !== 1) stop(`site manager 1 could not submit a pay run test report: ${submitError?.message}`)
  }
  return reportId
}

const payR1 = await payReport(PAY_D1, [
  { employee_id: payA, hours: 10 },
  { employee_id: payB, hours: 8 },
])
const payR2 = await payReport(PAY_D2, [{ employee_id: payA, hours: 4 }], { submit: false })
await payReport(PAY_D3, [
  { employee_id: payC, hours: 2 },
  { employee_id: payD.id, hours: 3 },
])

// --- Periods: create, no overlaps ---------------------------------------------------
let payPeriod = null
{
  const name = 'Owner creates a pay period (starts open)'
  const { data, error } = await owner.client
    .from('pay_periods')
    .insert({ start_date: payStart, end_date: payEnd, notes: `RLS test ${RUN_TAG}` })
    .select('id, status, created_by')
    .single()
  payPeriod = data?.id ?? null
  if (error) record(name, false, `Error: ${error.message}`)
  else record(name, data.status === 'open' && data.created_by === owner.userId, `${payStart} to ${payEnd}: ${data.status}.`)
  covers('pay_periods', 'pay_periods_before_write')
}
if (!payPeriod) stop('the pay run checks need the test pay period')

await attackInsert(
  'Owner creates a pay period that overlaps another',
  owner.client,
  'pay_periods',
  { start_date: shiftDate(payStart, 5), end_date: shiftDate(payStart, 20) },
  '23P01',
  'Refused: periods can never overlap.',
)
covers('pay_periods')

{
  const name = 'Suggested next period and gap check (owner)'
  const [next, gap] = await Promise.all([
    owner.client.rpc('next_pay_period_dates'),
    owner.client.rpc('pay_period_gap', { p_start: shiftDate(payEnd, 3) }),
  ])
  const row = next.data?.[0]
  const ok = !next.error && !gap.error && Boolean(row?.start_date) && Number(gap.data) === 2
  record(name, ok, ok ? `Suggests ${row.start_date} to ${row.end_date}; a start 3 days after this period shows a 2-day gap.` : `Got: ${JSON.stringify({ next, gap })}`)
  covers('next_pay_period_dates', 'pay_period_gap')
}

// --- Closing is blocked by a draft report and by unpriced hours ------------------
{
  const name = 'Close is blocked by a draft report and by unpriced hours - and says which'
  const blockers = await owner.client.rpc('pay_period_blockers', { p_period_id: payPeriod })
  const close = await owner.client.rpc('close_pay_period', { p_period_id: payPeriod })
  const rows = blockers.data ?? []
  const draft = rows.find((row) => row.kind === 'draft_report' && row.report_id === payR2)
  const unpriced = rows.find((row) => row.kind === 'unpriced_hours' && row.person_id === payC && row.report_date === PAY_D3)
  const pendingBlocks = rows.some((row) => row.person_id === payD.id)
  const ok = Boolean(draft) && Boolean(unpriced) && Number(unpriced.hours) === 2 && !pendingBlocks && close.error?.code === '23514'
  record(
    name,
    ok,
    ok
      ? `Blocked: the draft report of ${PAY_D2}, and 2 unpriced hours on ${PAY_D3}. The pending person does not block.`
      : `Blockers: ${JSON.stringify(rows)}; close: ${close.error?.message ?? 'no error'}`,
  )
  covers('pay_period_blockers', 'close_pay_period')
}

// Fix both: submit the draft, give C a rate from the period start (C has no paid days).
{
  const { data, error } = await site.client.from('daily_reports').update({ status: 'submitted' }).eq('id', payR2).select('id')
  if (error || data.length !== 1) stop(`site manager 1 could not submit the draft pay run test report: ${error?.message}`)
  await ownerInsert('employee_rates', { employee_id: payC, ...fromPeriodStart }, 'the rate that prices C')
}

// --- Close cleanly: the snapshot equals the 8A figures ---------------------------
let payRun1 = null
{
  const name = 'Owner closes the period: the snapshot equals the 8A pay figures'
  try {
    const close = await owner.client.rpc('close_pay_period', { p_period_id: payPeriod })
    if (close.error) throw close.error
    payRun1 = close.data
    const [{ data: lines, error: linesError }, { data: days, error: daysError }] = await Promise.all([
      owner.client.from('pay_run_lines').select('employee_id, included, hours, ordinary_hours, ot_hours, gross, rates').eq('run_id', payRun1),
      owner.client.from('labour_days').select('employee_id, total_pay').in('employee_id', [payA, payB, payC]).gte('day', payStart).lte('day', payEnd),
    ])
    if (linesError || daysError) throw linesError ?? daysError
    const line = (id, included = true) => lines.find((row) => row.employee_id === id && row.included === included)
    const live = (id) => days.filter((row) => row.employee_id === id).reduce((sum, row) => sum + Number(row.total_pay), 0)
    const a = line(payA)
    const problems = [
      Number(a?.gross) === 1500 && Number(a.ordinary_hours) === 12 && Number(a.ot_hours) === 2 ? null : `A: ${JSON.stringify(a)}`,
      Number(line(payB)?.gross) === 800 ? null : `B: ${JSON.stringify(line(payB))}`,
      Number(line(payC)?.gross) === 200 ? null : `C: ${JSON.stringify(line(payC))}`,
      [payA, payB, payC].every((id) => Number(line(id)?.gross) === live(id)) ? null : 'Snapshot differs from labour_days',
      Number(line(payD.id, false)?.hours) === 3 && line(payD.id, false)?.gross === null && !line(payD.id) ? null : `D: ${JSON.stringify(lines.filter((row) => row.employee_id === payD.id))}`,
      a?.rates?.[0]?.from === payStart && Number(a.rates[0].rate) === 100 ? null : `A's rates: ${JSON.stringify(a?.rates)}`,
    ].filter(Boolean)
    record(
      name,
      problems.length === 0,
      problems.length
        ? problems.join('; ')
        : 'A: 10 h + 4 h = R1,100 + R400 = R1,500 (12 ordinary + 2 overtime); B: 8 h = R800; C: R200 - all equal to labour_days. D (pending): excluded, 3 h.',
    )
  } catch (error) {
    record(name, false, `Error: ${error.message}`)
  }
  covers('close_pay_period', 'pay_runs', 'pay_run_lines', 'pay_run_days', 'labour_days')
}
if (!payRun1) stop('the lock checks need the closed pay run')

// --- Locks while closed --------------------------------------------------------------
{
  const name = 'Site manager saves a new report dated in the closed period'
  const { error } = await site.client.rpc('save_report_draft', {
    p_report: { project_id: payProject, report_date: PAY_D4, activities: 'attack' },
    p_crew: [{ employee_id: payA, hours: 8 }],
    p_equipment: [],
  })
  const ok = String(error?.message ?? '').includes('This period is closed. Contact the office.')
  record(name, ok, ok ? 'Refused: "This period is closed. Contact the office."' : `Got: ${error?.message ?? 'BREACH: it was saved'}`)
  covers('daily_reports_period_lock', 'save_report_draft')
}
{
  const name = 'Owner reopens a report dated in the closed period'
  const { error } = await owner.client
    .from('daily_reports')
    .update({ status: 'draft', reopen_reason: 'attack' })
    .eq('id', payR1)
    .select('id')
  const ok = String(error?.message ?? '').includes('This period is closed')
  record(name, ok, ok ? 'Refused: the period is closed.' : `Got: ${error?.message ?? 'BREACH: it was reopened'}`)
  covers('daily_reports_period_lock')
}
{
  // (Submitted lines are already locked to everyone; the period lock is the
  // second wall behind that.)
  const name = 'Crew lines of a report in the closed period cannot change'
  const { error } = await owner.client.from('report_crew').update({ hours: 1 }).eq('report_id', payR1).select('id')
  const { data: after } = await owner.client.from('report_crew').select('hours').eq('report_id', payR1).eq('employee_id', payA).single()
  const ok = Number(after?.hours) === 10
  record(name, ok, ok ? `Unchanged (${error ? `refused: ${error.message}` : 'nothing changed'}).` : `BREACH: hours now ${after?.hours}`)
  covers('report_lines_period_lock')
}
for (const [label, values, table] of [
  ['adds a rate dated inside the closed period', { employee_id: payA, hourly_rate: 150, effective_from: PAY_D2 }, 'employee_rates'],
  ['adds a pay rule dated inside the closed period', { effective_from: PAY_D2, ot_multiplier: 2 }, 'pay_rules'],
  ['adds a back-dated pay rule (before the period) that would change paid days', { effective_from: shiftDate(payStart, -10), ot_multiplier: 2 }, 'pay_rules'],
  ['adds a public holiday on a paid day', { holiday_date: PAY_D1, name: 'Attack' }, 'public_holidays'],
]) {
  await attackInsert(`Owner ${label}`, owner.client, table, values, PERMISSION_DENIED, 'Refused: it would change days already in a pay run.')
}
covers('employee_rates_period_lock', 'pay_rules_period_lock', 'public_holidays_period_lock')
{
  const name = "Owner voids the rate that priced paid days (it would change them)"
  const { data: rate } = await owner.client
    .from('employee_rates')
    .select('id')
    .eq('employee_id', payA)
    .eq('effective_from', payStart)
    .is('voided_at', null)
    .single()
  const { error } = await owner.client.from('employee_rates').update({ void_reason: 'attack' }).eq('id', rate?.id).select('id')
  record(name, error?.code === PERMISSION_DENIED, error ? `Refused: ${error.message}` : 'BREACH: the rate was voided.')
  covers('employee_rates_period_lock')
}
{
  const name = 'Owner reopens the pay period (only a system admin may)'
  const { error } = await owner.client.rpc('reopen_pay_period', { p_period_id: payPeriod, p_reason: 'attack' })
  record(name, error?.code === PERMISSION_DENIED, error ? `Refused: ${error.message}` : 'BREACH: the owner reopened it.')
  covers('reopen_pay_period')
}
{
  const name = 'Outstanding: the paid days are gone; the pending person\'s day is still there'
  const { data, error } = await owner.client
    .from('pay_outstanding')
    .select('employee_id, day, total_hours, period_status')
    .in('employee_id', [payA, payB, payD.id])
  const pending = data?.find((row) => row.employee_id === payD.id && row.day === PAY_D3)
  const ok = !error && !data.some((row) => row.employee_id === payA || row.employee_id === payB) && Number(pending?.total_hours) === 3 && pending.period_status === 'closed'
  record(name, ok, ok ? `A and B are paid; D's 3 h on ${PAY_D3} are still to be paid.` : `Got: ${error?.message ?? JSON.stringify(data)}`)
  covers('pay_outstanding')
}

// --- Site manager sees nothing ---------------------------------------------------------
for (const table of ['pay_periods', 'pay_runs', 'pay_run_lines', 'pay_run_days', 'pay_outstanding']) {
  await attackReadNothing(`Site manager reads ${table}`, site.client, table)
  covers(table)
}
for (const [fn, args] of [
  ['close_pay_period', { p_period_id: payPeriod }],
  ['mark_pay_period_paid', { p_period_id: payPeriod, p_paid_on: payEnd }],
  ['reopen_pay_period', { p_period_id: payPeriod, p_reason: 'attack' }],
]) {
  const name = `Site manager calls ${fn}()`
  const { error } = await site.client.rpc(fn, args)
  record(name, error?.code === PERMISSION_DENIED, error ? `Refused: ${error.message}` : 'BREACH: it ran.')
  covers(fn)
}
for (const [fn, args] of [
  ['pay_period_blockers', { p_period_id: payPeriod }],
  ['next_pay_period_dates', {}],
  ['pay_period_gap', { p_start: payEnd }],
]) {
  const name = `Site manager calls ${fn}()`
  const { data, error } = await site.client.rpc(fn, args)
  const empty = Array.isArray(data) ? data.length === 0 : data === null
  if (error?.code === PERMISSION_DENIED) record(name, true, 'Server refused (permission denied).')
  else if (error) record(name, false, `Unexpected error: ${error.message}`)
  else record(name, empty, empty ? 'Nothing came back.' : `LEAK: ${JSON.stringify(data)}`)
  covers(fn)
}
for (const fn of [
  'pay_periods_before_write',
  'pay_date_locked',
  'daily_reports_period_lock',
  'report_lines_period_lock',
  'employee_rates_period_lock',
  'pay_rules_period_lock',
  'public_holidays_period_lock',
]) {
  const name = `Site manager calls ${fn}() directly`
  const { error } = await site.client.rpc(fn, fn === 'pay_date_locked' ? { p_company_id: randomUUID(), p_day: payStart } : {})
  record(name, Boolean(error), error ? `Refused: ${error.message}` : 'BREACH: it ran.')
  covers(fn)
}

// --- System admin reopens; the old snapshot is kept ---------------------------------------
{
  const name = 'System admin reopens without a reason'
  const { error } = await admin.client.rpc('reopen_pay_period', { p_period_id: payPeriod, p_reason: ' ' })
  record(name, error?.code === '23514', error ? `Refused: ${error.message}` : 'BREACH: reopened without a reason.')
  covers('reopen_pay_period')
}
let payRun2 = null
{
  const name = 'System admin reopens with a reason; closing again makes version 2 and v1 is kept as superseded'
  try {
    const reopen = await admin.client.rpc('reopen_pay_period', { p_period_id: payPeriod, p_reason: `RLS test ${RUN_TAG}` })
    if (reopen.error) throw reopen.error
    const { data: period } = await owner.client.from('pay_periods').select('status, reopened_by, reopen_reason').eq('id', payPeriod).single()
    const close = await owner.client.rpc('close_pay_period', { p_period_id: payPeriod })
    if (close.error) throw close.error
    payRun2 = close.data
    const { data: runs } = await owner.client.from('pay_runs').select('id, version, status, superseded_reason').eq('period_id', payPeriod).order('version')
    const { data: a2 } = await owner.client.from('pay_run_lines').select('gross').eq('run_id', payRun2).eq('employee_id', payA).eq('included', true).single()
    const ok =
      period?.status === 'reopened' &&
      period.reopened_by === admin.userId &&
      runs?.length === 2 &&
      runs[0].id === payRun1 &&
      runs[0].status === 'superseded' &&
      runs[0].superseded_reason === `RLS test ${RUN_TAG}` &&
      runs[1].version === 2 &&
      runs[1].status === 'active' &&
      Number(a2?.gross) === 1500
    record(name, ok, ok ? 'Reopened (logged with who and why); v1 kept as superseded; v2 active with the same R1,500 for A.' : `Period ${JSON.stringify(period)}; runs ${JSON.stringify(runs)}; A ${JSON.stringify(a2)}`)
  } catch (error) {
    record(name, false, `Error: ${error.message}`)
  }
  covers('reopen_pay_period', 'close_pay_period', 'pay_runs')
}
{
  const name = 'Owner marks the period paid, with the paid date'
  const { error } = await owner.client.rpc('mark_pay_period_paid', { p_period_id: payPeriod, p_paid_on: payEnd })
  const { data: period } = await owner.client.from('pay_periods').select('status, paid_on, paid_by').eq('id', payPeriod).single()
  const { data: run } = await owner.client.from('pay_runs').select('paid_on').eq('id', payRun2 ?? randomUUID()).maybeSingle()
  const ok = !error && period?.status === 'paid' && period.paid_on === payEnd && period.paid_by === owner.userId && run?.paid_on === payEnd
  record(name, ok, ok ? `Paid on ${payEnd}; the run records it too.` : `Error: ${error?.message}; period ${JSON.stringify(period)}; run ${JSON.stringify(run)}`)
  covers('mark_pay_period_paid')
}

// --- Late hours: the pending person, approved later, is paid in the next run ------------
{
  const name = 'Late hours: the pending person, approved later, is paid in the next run'
  try {
    // Their rate may start inside the paid period - none of their days were paid.
    await approveEmployee(owner.client, payD.id, 100, payStart)
    const nextStart = shiftDate(payEnd, 1)
    const { data: next, error: nextError } = await owner.client
      .from('pay_periods')
      .insert({ start_date: nextStart, end_date: shiftDate(nextStart, 13), notes: `RLS test ${RUN_TAG} (late hours)` })
      .select('id')
      .single()
    if (nextError) throw nextError
    const close = await owner.client.rpc('close_pay_period', { p_period_id: next.id })
    if (close.error) throw close.error
    const [{ data: line }, { data: day }, { data: outstanding }] = await Promise.all([
      owner.client.from('pay_run_lines').select('gross, late_hours').eq('run_id', close.data).eq('employee_id', payD.id).eq('included', true).maybeSingle(),
      owner.client.from('pay_run_days').select('late, total_pay').eq('run_id', close.data).eq('employee_id', payD.id).eq('day', PAY_D3).maybeSingle(),
      owner.client.from('pay_outstanding').select('day').eq('employee_id', payD.id),
    ])
    await owner.client.rpc('mark_pay_period_paid', { p_period_id: next.id, p_paid_on: shiftDate(nextStart, 13) })
    const ok = Number(line?.gross) === 300 && Number(line.late_hours) === 3 && day?.late === true && (outstanding ?? []).length === 0
    record(name, ok, ok ? `Approved at R100: the 3 h of ${PAY_D3} paid in the next run as late hours (R300); no longer outstanding.` : `Line ${JSON.stringify(line)}; day ${JSON.stringify(day)}; outstanding ${JSON.stringify(outstanding)}`)
  } catch (error) {
    record(name, false, `Error: ${error.message}`)
  }
  covers('close_pay_period', 'pay_run_days', 'pay_outstanding', 'employee_rates_period_lock')
}

// --- Finish off this run's pay run test data (nothing can be deleted) -----------------
{
  const outcomes = await Promise.all([
    owner.client.from('projects').update({ status: 'complete' }).eq('id', payProject).select('id'),
    owner.client.from('employees').update({ status: 'inactive' }).eq('id', payD.id).select('id'),
  ])
  const failed = outcomes.find((outcome) => outcome.error)
  if (failed) console.log(`          (note: tidy-up incomplete: ${failed.error.message})`)
}

// --- Every object created in phases 5 and 6 (and since) must be attacked ------
// (Rework A's file is left out: everything it created was undone by the
// undo-rework-A file, which is checked here instead.)
for (const [phase, file] of [
  [5, '20261005120000_budgets_and_costing.sql'],
  [6, '20261006090000_dashboard.sql'],
  ['6 (insights)', '20261006120000_dashboard_insights.sql'],
  ['"undo rework A"', '20261007090000_undo_rework_a.sql'],
  ['rework B', '20261007120000_rework_b_crew_and_new_employees.sql'],
  ['rework C', '20261007150000_rework_c_drilldown.sql'],
  ['7a (exports)', '20261008090000_phase7a_exports.sql'],
  ['8A-1 (overtime)', '20261009090000_phase8a1_overtime.sql'],
  ['8B-1 (pay runs)', '20261010090000_phase8b1_pay_runs.sql'],
  ['export filter', '20261011090000_export_project_filter.sql'],
]) {
  const sql = readFileSync(fileURLToPath(new URL(`../supabase/migrations/${file}`, import.meta.url)), 'utf8')
  const created = [...sql.matchAll(/create\s+(?:or\s+replace\s+)?(table|view|function)\s+public\.(\w+)/gi)].map(
    ([, kind, name]) => ({ kind: kind.toLowerCase(), name }),
  )
  console.log(`\n          Everything phase ${phase} creates, and the checks that attack it:`)
  const notAttacked = []
  for (const { kind, name } of created) {
    const checks = [...new Set(coverage.get(name) ?? [])]
    const failed = checks.filter((number) => !results[number - 1])
    console.log(
      `          ${kind.padEnd(9)}${name.padEnd(38)}${checks.length ? `checks ${checks.join(', ')}` : 'NOT ATTACKED'}` +
        (failed.length ? `  (failed: ${failed.join(', ')})` : ''),
    )
    if (checks.length === 0) notAttacked.push(name)
  }
  console.log('')
  record(
    `Every table, view and function created in phase ${phase} has an attack`,
    created.length > 0 && notAttacked.length === 0,
    notAttacked.length ? `Not attacked: ${notAttacked.join(', ')}` : `${created.length} objects, all attacked.`,
  )
}

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
