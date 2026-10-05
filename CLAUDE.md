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

