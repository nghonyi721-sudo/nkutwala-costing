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
const TEST_PROJECT_NAME = 'ZZ RLS Test Project'
const TEST_RATES = [
  { hourly_rate: 100, effective_from: '2026-01-01' },
  { hourly_rate: 120, effective_from: '2026-06-01' },
]

// Columns site managers are allowed to receive. Anything else in a response
// (e.g. a budget or rate column added later) makes the test FAIL.
const ALLOWED_COLUMNS = {
  projects: ['id', 'company_id', 'name', 'contract_number', 'status', 'created_at'],
  employees: ['id', 'company_id', 'full_name', 'category', 'active', 'created_at'],
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

// An insert the site manager must NOT be allowed to do.
async function attackInsert(name, client, table, values) {
  const { data, error } = await client.from(table).insert(values).select('id')
  if (error?.code === PERMISSION_DENIED) {
    record(name, true, 'Server refused.')
  } else if (error) {
    record(name, false, `Unexpected error: ${error.message}`)
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

for (const table of ['projects', 'employees']) {
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
