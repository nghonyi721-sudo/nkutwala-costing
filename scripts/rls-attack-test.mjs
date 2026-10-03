// Rate Wall attack test.
//
// Logs in as the site_manager test user with the PUBLIC (anon) key - exactly
// what the app or an attacker with the app's key could do - and tries to get
// data it must never see. Then logs in as the owner test user to prove the
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

import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)))

const url = process.env.VITE_SUPABASE_URL
const anonKey = process.env.VITE_SUPABASE_ANON_KEY

const results = []

function record(name, passed, detail) {
  results.push(passed)
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}\n      ${detail}`)
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

// Postgres "permission denied" - the server refused outright.
const PERMISSION_DENIED = '42501'

// --- Attacks as the site manager ---------------------------------------------
console.log('\nRate Wall attack test\n')
console.log('Logging in as the site manager test user…\n')

const site = await signIn(process.env.TEST_SITE_EMAIL, process.env.TEST_SITE_PASSWORD)

const startingRole = await readOwnRole(site.client, site.userId)
if (startingRole !== 'site_manager') {
  stop(
    `the TEST_SITE_EMAIL user's role is "${startingRole ?? 'unreadable'}", not site_manager. ` +
      'Fix the role in the profiles table, then run again.',
  )
}

// Attack 1: list everyone's profile.
{
  const { data, error } = await site.client.from('profiles').select('id, role')
  if (error) {
    record('1. Site manager reads all profiles', false, `Unexpected error: ${error.message}`)
  } else {
    const others = data.filter((row) => row.id !== site.userId)
    const sawOwn = data.some((row) => row.id === site.userId)
    if (others.length > 0) {
      record(
        '1. Site manager reads all profiles',
        false,
        `LEAK: could see ${others.length} other person's profile(s).`,
      )
    } else if (!sawOwn) {
      record(
        '1. Site manager reads all profiles',
        false,
        'Inconclusive: could not even see their own profile.',
      )
    } else {
      record('1. Site manager reads all profiles', true, 'Only their own profile came back.')
    }
  }
}

// Attack 2: promote themselves to owner.
{
  const { data, error } = await site.client
    .from('profiles')
    .update({ role: 'owner' })
    .eq('id', site.userId)
    .select('role')

  const refused = error?.code === PERMISSION_DENIED
  const changedNothing = !error && data.length === 0
  const roleAfter = await readOwnRole(site.client, site.userId)

  if (error && !refused) {
    record('2. Site manager makes themselves owner', false, `Unexpected error: ${error.message}`)
  } else if (roleAfter !== 'site_manager') {
    record(
      '2. Site manager makes themselves owner',
      false,
      `BREACH: role is now "${roleAfter ?? 'unreadable'}". Reset it in the profiles table NOW.`,
    )
  } else if (refused || changedNothing) {
    record(
      '2. Site manager makes themselves owner',
      true,
      `${refused ? 'Server refused (permission denied)' : 'Server changed nothing'}; role is still site_manager.`,
    )
  } else {
    record('2. Site manager makes themselves owner', false, 'Update reported success.')
  }
}

// Attack 3: read the owner-only table.
{
  const { data, error } = await site.client.from('owner_only_test').select('*')
  if (error?.code === PERMISSION_DENIED) {
    record('3. Site manager reads owner_only_test', true, 'Server refused (permission denied).')
  } else if (error) {
    record('3. Site manager reads owner_only_test', false, `Unexpected error: ${error.message}`)
  } else if (data.length > 0) {
    record(
      '3. Site manager reads owner_only_test',
      false,
      `LEAK: ${data.length} owner-only row(s) were sent to a site manager.`,
    )
  } else {
    record('3. Site manager reads owner_only_test', true, 'Zero rows came back.')
  }
}

await site.client.auth.signOut()

// --- Control check as the owner ----------------------------------------------
console.log('\nLogging in as the owner test user…\n')

const owner = await signIn(process.env.TEST_OWNER_EMAIL, process.env.TEST_OWNER_PASSWORD)

{
  const ownerRole = await readOwnRole(owner.client, owner.userId)
  const { data, error } = await owner.client.from('owner_only_test').select('id')
  if (ownerRole !== 'owner') {
    record(
      '4. Owner reads owner_only_test (control)',
      false,
      `The TEST_OWNER_EMAIL user's role is "${ownerRole ?? 'unreadable'}", not owner.`,
    )
  } else if (error) {
    record('4. Owner reads owner_only_test (control)', false, `Error: ${error.message}`)
  } else if (data.length === 0) {
    record(
      '4. Owner reads owner_only_test (control)',
      false,
      'Owner saw zero rows - the table is empty or the owner rule is broken, so check 3 proves nothing.',
    )
  } else {
    record('4. Owner reads owner_only_test (control)', true, `Owner can see ${data.length} row(s).`)
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
