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
Site managers may ADD a new person (first name(s), optional surname,
category, phone) - always as Pending - and fix the pending people they
added. Only owner/system_admin
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
- Nothing is ever hard-deleted. Void or correct only. (One exception, the
  owner's decision in Oct 2026: pay rules, public holidays, pay periods and
  pay runs were deleted for good with their rows - 20261014090000. The
  audit log still holds their history.)
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
- Employees: surname is optional; when set, the full name ENDS with it
  (database check) and first_names is worked out by the database. The
  forms ask "First name(s)" + "Surname" (fullNameOf in employeeSteps.js).
  uif_registered: only owners/admins change it (employees_before_write).

## Overtime (a fixed rule - there are no pay rule settings)
- No pay rules, holiday calendar, pay periods or pay runs any more (all
  deleted in 20261014090000) and no "period is closed" locks: the exported
  payroll file is the record.
- The rule is written into labour_days: per person per DAY across all
  reports, up to 8 h normal, the rest overtime at x1.5. A report switched
  to "Sunday or public holiday" (daily_reports.all_overtime, on the site
  manager's form, locked after submit) is ALL overtime.
- Labour pay is then shared between projects by hours (labour_lines; the
  biggest ordinary line takes the leftover cent). ALL labour cost
  (project_cost_lines, dashboard, drill-down, exports, payroll) comes from
  these. Overtime is shown as its own figures. The Sunday/holiday
  "premium" columns are still in the views but always 0 (kept so the
  dashboard and export functions didn't need rebuilding).
- Owned plant has no overtime. Pending/unpriced hours stay unpriced.
- Overtime WARNINGS (overtime_warnings, warn only): a day over 12 h (all
  projects) or a Mon-Sun week over 10 h of overtime - fixed limits. Shown
  on the dashboard ("Overtime limits" card) and a person's days.
- SPEED: labour_lines reads labour_days through a MATERIALIZED step (and
  its lines too). Without it, functions (dates/project unknown at plan
  time) recomputed every day's pay per report line: ~2 s each and the
  dashboard/test hit the 8 s statement limit. Keep it when changing
  labour_lines; time new labour functions with a read-only check.
- SPEED: labour_days gets the rate from a LATERAL step with OFFSET 0
  (20261014100000), so rate_on() runs once per person per day. Without it
  Postgres folds the step in and calls rate_on() for every use of the rate
  (~6 times - the dashboard was 3-4x slower). Keep it.

## Payroll and expenses exports (docs/payroll-export-format.md)
- THE SPEC FILE IS THE AUTHORITY for layout and wording (cell positions,
  merges, headers - OVER TIME = hours in G, OVERTIME = money in J). The
  owner's real workbook is NOT in the repo (real names and pay; docs/*.xlsx
  is gitignored).
- Screen: More -> Payroll (src/pages/admin/payroll/PayrollPage.jsx, lazy,
  owner/admin): project, start date, end date (any dates), Download
  payroll, Download expenses statement. payroll_checks first: people with
  hours but no rate BLOCK the payroll (named); drafts and receipts waiting
  are warnings.
- Database (all owner/admin only: payroll_check_inputs raises 42501 for
  anyone else): payroll_lines (per 14-day block, per person, PER RATE -
  a rate change gives two rows), payroll_blocks (block totals, month
  summary, SARS UIF = employee UIF x 2), expense_lines, expense_totals,
  round_half_even. payroll_lines refuses while anyone has unpriced hours
  in the range - never a silent R0.
- Blocks: 14 days from the start date, the last one ends on the end date;
  each goes on the sheet of the month it ENDS in (sheet "SEPTEMBER 2026"),
  FIRST / SECOND / THIRD FORTNIGHT.
- Money: GROSS = normal h x rate, OVERTIME = OT h x rate x 1.5, TOTAL,
  UIF = TOTAL x 0.01 only if uif_registered (else the cell is BLANK), NET.
  Every value rounded half-to-even in the database before any total. Rows
  are plain numbers (an Excel formula would round 215.625 up); TOTALS and
  summary lines are formulas carrying the database's figures.
- Expenses: approved receipts only, oldest first. PAID BY is always
  "Company" for now (receipts don't record who paid). By category:
  Materials, Fuel, Plant hire, Consumables always, other categories when
  they have amounts. Amounts VAT inclusive.
- Builders: src/lib/exports/payroll.js, expenses.js and their shared look
  houseStyle.js (Arial, the workbook's colours and widths, columns C-M,
  no gridlines). Rows 2-3, above the spec's layout: the POPIA line and
  "Generated ... by ...". No frozen header or filter (multi-table layout).
- export_log types 'payroll' and 'expenses_statement'; files
  nkutwala_payroll_{project}_{from}_{to}.xlsx and nkutwala_expenses_....
- Supabase sends at most 1,000 rows per request: the payroll and expense
  rows are fetched with callAll (workbook.js, 1,000 at a time) so a long
  range or a big crew is never cut short. Use it for any export that can
  pass 1,000 rows.

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
- The payroll is the Payroll screen's file (see Payroll and expenses
  exports); the old Payroll hours sheet and pay-run Excel were removed.
  Their past rows stay in the export log ('payroll_hours', 'pay_run').
- Site manager exports (7c): only the projects they have their own
  reports on (my_report_projects), own submitted reports, quantities only
  (my_labour_return - never a rand value).

## Bundling (code splitting)
- Site-manager screens (login, app shell, My reports + daily report form,
  My receipts + Add receipt) stay in the first download - they must open
  fast on weak signal.
- Every owner/admin-only screen is React.lazy in HomePage.jsx (with its
  title in TITLES) - including new ones (payroll, approvals).
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
Payroll deductions other than UIF (PAYE, tax tables, payslips), offline
sync, receipt OCR, multi-tenancy, invoicing, variations. If I ask for one,
remind me it was cut. (UIF 1% for UIF-registered people IS in - the payroll
export, the owner's decision in Oct 2026.)

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

