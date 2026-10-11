# CLAUDE.md

Guidance for Claude when working on this project.

## Project overview

Internal job-costing app for Nkutwala (South African civil construction).
Replaces the paper Daily Activity Report.

## Tech stack

- React + Vite (JavaScript, not TypeScript)
- Supabase (database + auth) via `@supabase/supabase-js`
- Supabase client lives in `src/lib/supabaseClient.js`; settings in `.env`

## Commands

- `npm run dev` - start the local dev server (http://localhost:5173)
- `npm run build` - build for production
- `npm run lint` - check code for problems

## Working with me

- I'm not an experienced developer; explain changes in plain language.
- I'm on Windows using PowerShell.

## Project rules

<!-- Paste project rules here -->
# Nkutwala Site Costing

Internal job-costing app for a South African civil construction company.
Replaces a paper Daily Activity Report. NOT a SaaS product.

## Roles
- system_admin — full access, data administration
- owner — all costs, rates, gross pay, approvals
- site_manager — quantities ONLY. Never rates, never totals.
Employees do not log in. Site managers record them by name.
Site managers may ADD a new person (name, category, phone) - always as
Pending - and fix the pending people they added. Only owner/system_admin
approve someone, and only together with a dated hourly rate
(approve_employee). Rejecting needs a reason. Owners adding someone
enter the rate on the same form.

## THE RATE WALL — the most important rule in this project
Site managers must never receive money data. Not hidden in the UI —
NEVER SENT BY THE SERVER. Enforce with Supabase row-level security.
Any endpoint returning rates, costs or pay requires owner/admin role.
If you are about to send a rand value to a site_manager, STOP and flag it.

## Security rules
- NEVER use the service_role key in frontend code. If a task seems to
  need it, stop and explain why before writing anything.
- Never commit secrets. Keys live in .env, which is gitignored.
- Point at the DEV Supabase project. Never production.
## Data rules
- Nothing is ever hard-deleted. Void or correct only.
- Corrections create a NEW record. The original is kept.
- Every write goes to audit_log: actor, action, entity, before, after, time.
- Rates are dated (effective_from). Old months recalculate at OLD rates.
- One daily report per manager per project per day.
  Two managers must never overwrite each other.
- Store timestamps in UTC. Report date is the site's local calendar date.
- Employee status: pending / approved / inactive. A pending person's hours
  are UNPRICED until they are approved (rate_on() only prices approved
  people) - never silently zero.
- Project teams (project_employees): who works where. Never deleted -
  switched off. A new daily report starts with the project's team.
- Absent = 0 hours on a crew line; the row stays on the report.

## Pay rules and overtime (phase 8A)
- pay_rules: dated (effective_from), never edited - void with a reason
  and add a new rule from a date. Each day uses the rule in force that day.
  ON: daily OT above 8 h at x1.5. Built but OFF: weekly OT above 45 h,
  Sunday x2.0, public holiday x2.0 (public_holidays table, void-only).
- Labour pay is worked out per person per DAY across all reports
  (labour_days), then shared between projects by hours (labour_lines; the
  project with most hours takes the leftover cent). ALL labour cost
  (project_cost_lines, dashboard, drill-down, exports) comes from these.
  Overtime is shown as its own figures. "Before deductions", provisional.
- Owned plant has no overtime. Pending/unpriced hours stay unpriced.
- 8A-2 screens (More -> Pay rules and holidays, also from Pay runs;
  src/pages/admin/payRules/, lazy): the rule in force today, "change the
  rules from a date" (a NEW rule - steppers and switches), history with
  void (reason), public holidays by year (add, void). The first live rule
  can never be voided (trigger pay_rules_00_keep_first, runs before the
  8B-1 lock).
- Overtime WARNINGS (overtime_warnings, warn only): a day over
  warn_daily_hours (all projects) or a Mon-Sun week over
  warn_weekly_ot_hours of overtime, limits from the rule in force. Shown
  on the dashboard ("Overtime limits" card) and a person's days.
- SPEED: labour_lines reads labour_days through a MATERIALIZED step (and
  its lines too). Without it, functions (dates/project unknown at plan
  time) recomputed every day's pay per report line: ~2 s each and the
  dashboard/test hit the 8 s statement limit. Keep it when changing
  labour_lines; time new labour functions with a read-only check.

## Pay periods and pay runs (phase 8B)
- pay_periods never overlap (database constraint). open -> closed ->
  paid; only a system_admin reopens, with a reason.
- Closing saves a snapshot (pay_runs v1, v2..., pay_run_lines per person,
  pay_run_days per day). It never changes; reopening marks it superseded.
- Close is blocked by draft reports or unpriced hours of approved people.
  Pending people are left out (excluded) and paid later as late hours.
- LOCKS (database triggers) while closed/paid: reports and their lines
  dated in it can't change ("This period is closed. Contact the office.");
  no rate, pay rule or holiday may change a day already in an active run.
- close/mark paid/reopen and the lock triggers are SECURITY DEFINER (they
  write/see what the app can't); everything else invoker.
- Site managers see nothing of pay periods or runs.
- 8B-2 screens (More -> Pay runs, src/pages/admin/pay/, lazy): periods
  list (pay_period_overview), new period on the suggested dates with a gap
  warning, blockers (draft report -> ReportView, unpriced -> PersonRates),
  preview, Close, Mark paid, Reopen (system_admin), versions, Outstanding
  (pay_outstanding_people).
- The preview and the close share pay_period_close_days: never change one
  without the other. close_pay_period also freezes the PROJECT SPLIT
  (pay_run_allocations, from labour_lines); runs closed before 8B-2 have
  none (their filtered Excel isn't offered).
- Pay-run Excel (src/lib/exports/payRun.js) only from the snapshot
  (pay_run_people / pay_run_grid), export_log type 'pay_run'. Superseded
  versions say "SUPERSEDED — DO NOT PAY FROM THIS VERSION".

## Exports (phase 7)
- Excel with ExcelJS (never the "xlsx" package). PDFs: print-friendly
  pages saved through the browser (no PDF library).
- Every figure and total comes from a database function (security
  invoker + owner/admin check for money). No arithmetic in JS: totals
  rows are SUM formulas carrying the database's total.
- Shared builders in src/lib/exports/ (plain JS, the attack test builds
  the same files). Money "R" #,##0.00 as real numbers, real dates, bold
  frozen header, autofilter, title rows, POPIA line on money/personal
  data, receipts labelled VAT inclusive.
- Filename: nkutwala_{report}_{project}_{from}_{to}.xlsx
- Every export writes export_log first (who/what/filters/when, set by
  the database); no log row, no file. Owner/admin read the log.
- Receipt photos are never put in files as expiring links: link into the
  app instead (owner login needed).
- PROJECT FILTER on every export (p_project_ids uuid[], null = all
  projects), combined with the dates / pay period. Filtering happens in
  the database functions, never in JS. All projects: line items as before
  (labour one row per person, "Projects worked" listed). Chosen projects:
  a Project column, rows per person per project; two or more: a subtotal
  per project (the database's project_total_...) and a grand total.
  Projects shown in the title rows; filename
  nkutwala_{report}_{all-projects | name | a+b+c | n-projects}_{from}_{to}.xlsx
  export_log filters record projects, project_ids, project_names.
- PAY FILES (payroll hours sheet, pay run export, annual earnings):
  All projects = full pay, top line "GROSS BEFORE DEDUCTIONS — NOT A
  PAYSLIP". Filtered = labour cost allocated to those projects (overtime
  as allocated by labour_lines), top line "PROJECT LABOUR COST ALLOCATION
  — NOT THE AMOUNT TO PAY EMPLOYEES", filename labour-allocation, logged
  with allocation: true. Every pay file says: pay only from the
  unfiltered (All projects) pay run.
- Site manager exports (7c): only the projects they have their own
  reports on (my_report_projects), own submitted reports, quantities only
  (my_labour_return - never a rand value).

## Bundling (code splitting)
- Site-manager screens (login, app shell, My reports + daily report form,
  My receipts + Add receipt) stay in the first download - they must open
  fast on weak signal.
- Every owner/admin-only screen is React.lazy in HomePage.jsx (with its
  title in TITLES) - including new ones (pay runs, pay rules, approvals).
  The lazy screens sit inside LoadError (Try again) + Suspense (title and
  skeleton rows).
- ExcelJS and recharts are only ever reached through import(): ExcelJS via
  src/lib/exports/run.js, charts via src/pages/admin/LazyCharts.jsx -
  never import DashboardCharts.jsx or workbook.js directly from a screen.
- vite.config.js: react and @supabase in their own cached chunks, matched
  by exact package name (never a catch-all node_modules group).
- The build shows ONE expected size warning: the ExcelJS chunk (~935 kB,
  a single pre-built file, downloaded only when exporting). Do not raise
  chunkSizeWarningLimit; any OTHER chunk over 500 kB is a real problem.

## Deployment (Vercel) and the installable app (PWA)
- vercel.json: every path except /assets/ serves index.html (refreshing
  /dashboard works); /assets/ cached a year (hashed names), everything
  else no-cache so phones always see new versions.
- Vercel env vars VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY point at the
  DEV project (never production, never the service_role key).
- vite-plugin-pwa (vite.config.js): installable as "Nkutwala Site Reports"
  / "Nkutwala". Icons in public/ are the logo's N + gear mark (regenerate
  if a bigger or vector logo arrives).
- The service worker NEVER caches Supabase (API, auth, storage, photos):
  no cache rule may match another address. Precache = only the start
  page's files (recordStartPageFiles) + icons; other /assets/ files are
  cached when first opened. Do not precache all of /assets/ - site
  managers would download owner screens and ExcelJS.
- autoUpdate without a forced reload: a new version is used the next time
  the app is opened - never reload mid-form (unsaved reports).
- iPhone: status bar "default" (light header), apple-touch-icon.png.

## Sign-in page
- LoginPage.jsx -> src/pages/login/: SitePass (the look: soft blue band
  with date + greeting, SITE ACCESS card), LoginForm, useSignIn (messages),
  useKeyboardSafe, today.js. Sign-in itself is plain Supabase
  signInWithPassword - no sign-up, no reset email ("Contact the office").
- ONE message for every refusal: "Email or password is incorrect." Never
  say which was wrong or whether an account exists. Offline / too many
  tries / server down have their own messages (useSignIn.js).
- Fields: autocomplete username / current-password in one <form>, 17px
  text (no iPhone zoom), show/hide password 48px. useKeyboardSafe keeps
  Sign in above the on-screen keyboard. Never height/100vh/overflow:hidden
  or scroll locking on this page (min-height: 100svh only).
- Colours: "soft blue" set in SitePass.module.css, redefining the tokens
  on this page only (the rest of the app keeps the logo blue).
- Version on the card: VITE_APP_VERSION = package.json version + commit,
  set in vite.config.js at build time.

## Launch screen (splash)
- Plain HTML + inline CSS + inline SVG in index.html (#splash), so it shows
  before any JavaScript - never move it into React. Design "Turning gear":
  the logo redrawn as vector shapes (the N's blue and red interlocking
  blades; the gear = left half of an 8-tooth gear, open towards the words,
  with its dot) - the gear + dot turn as one piece, 4 s a turn (the one
  animation; stops on the slow message; Reduce Motion: still, "Loading…",
  no fade). Under it "Nkutwala" / "Construction" exactly as the logo, then
  "SITE REPORTS".
- Logo fonts (matched by overlaying on logo.jpeg): "Nkutwala" = Fira Sans
  Extra Condensed Bold squeezed to 93.8% width; "Construction" = Fira Sans
  Italic, +0.052 em spacing; "SITE REPORTS" = Fira Sans Extra Condensed
  SemiBold, +0.32 em. All SIL Open Font License. They are SVG OUTLINES in
  index.html (made with opentype.js from the Google Fonts files) - no font
  file is downloaded. The slow/offline message and Try again use the
  system font. If the logo changes, remake the outlines the same way.
- vite.config.js stylesAfterSplash(): the build moves the app's stylesheet
  links to the end of <body> so they don't hold back drawing the splash
  (the app's code still waits for them - no unstyled flash).
- hideSplash() (src/lib/splash.js) fades it 0.2 s then REMOVES it from the
  page - never just hidden, no fixed full-screen layer left behind. Called
  when the first screen is ready: App (logged out / no Supabase keys) and
  HomePage (once the profile/role has loaded or failed). App renders
  nothing while the session is still being read.
- Before the LOGIN page it stays at least 3 s from page start
  (LOGIN_SPLASH_MS in App.jsx, hideSplash({ atLeast })) - the owner's
  choice. Signed-in launches have no minimum (site managers on weak
  signal); a slow start never adds the 3 s on top.
- index.html's own inline script: after 10 s still there -> "Taking longer
  than usual — check your signal" (or the offline message) + Try again
  (reload). Must work without the app's JavaScript.
- Never overflow:hidden / 100vh / scroll locking on html or body.
- Colours: #F2F2F7 light / #000 dark (the app's background). The manifest
  background_color and theme_color are #F2F2F7 to match - change them
  together. No iPhone startup images (iOS's own launch screen is white).

## Out of scope for v1 — do NOT build these
Payroll deductions (PAYE/UIF), offline sync, receipt OCR, multi-tenancy,
invoicing, variations. If I ask for one, remind me it was cut.

## Working rules
- Small vertical slices. One feature at a time.
- Use plan mode. Tell me what you intend before touching files.
- Explain what you built in plain language before I accept it.
- Stop and ask before changing the database schema.

## Field conditions (affects every UI decision)
The daily report is filled outdoors, standing up, in bright sun,
sometimes with dusty or gloved hands. Tap targets at least 48px.
Large text, high contrast, fewest possible taps. Big buttons over
small dropdowns. Steppers over free typing.

