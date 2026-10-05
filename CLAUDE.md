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

