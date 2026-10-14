# Export formats — payroll and expenses

Two exports. Both are driven by the owner choosing a **project**, a **start date** and an **end date**. Nothing else.

There is no pay-run entity, no pay-rules engine, no holiday calendar. The exported file is the record.

---

## Inputs the owner chooses

| Field | Notes |
|---|---|
| Project | e.g. Swallendam Waste Treatment |
| Start date | any date |
| End date | any date — periods do NOT have to align to calendar months |

The real file has a period running 28 Aug – 10 Sept, so never assume month boundaries.

---

## Calculation rules (all of them)

These are derived from the existing Swallendam workbook. There are only four.

1. **Normal vs overtime split.** For each employee, each day: hours up to 8 are normal, anything above 8 is overtime. Sum each across the chosen date range.
   - A public holiday or Sunday worked is logged by the site manager as overtime hours. No holiday calendar.
   - A rain/no-work day is simply no hours logged.

2. **Money.**
   ```
   GROSS SALARY  = NORMAL HOURS  x RATE
   OVERTIME      = OVERTIME HOURS x RATE x 1.5
   TOTAL SALARY  = GROSS SALARY + OVERTIME
   UIF           = TOTAL SALARY x 0.01   (only if employee is UIF-registered)
   NET SALARY    = TOTAL SALARY - UIF
   TOTAL HOURS   = NORMAL HOURS + OVERTIME HOURS
   ```

3. **UIF registration** is a boolean on the employee record. If false, leave the UIF cell **blank** (not 0) and NET = TOTAL SALARY.

4. **Rounding.** Round each money value to 2 decimals *before* summing the column. Use banker's rounding (round half to even) — this is what reproduces the existing file: `2.3 x 62.5 x 1.5 = 215.625` appears as `215.62`, and `4562.50 + 215.62 = 4778.12`.

**Rates are dated.** Always use the rate that applied on the report date, never today's rate.

---

## EXPORT 1 — Payroll spreadsheet

One sheet per period. Layout below is exact — column C through M, starting at row 5.

### Header block

| Cell | Content | Notes |
|---|---|---|
| C5 | `NKUTWALA CONSTRUCTION — PAYROLL` | merged C5:M5 |
| C6 | `<PROJECT NAME>  \|  <PERIOD LABEL>` | merged C6:M6 — two spaces either side of the pipe |
| C8 | `RATE ASSUMPTIONS` | merged C8:D8 |
| C9 / D9 | `Daily Rate (8 hrs)` / `300` | |
| C10 / D10 | `Overtime / PH (x)` / `1.5` | |
| C11 / D11 | `UIF rate` / `0.01` | formatted as a number, not a percentage |
| F9 | `View: TOTAL HOURS / GROSS / OVERTIME / TOTAL SALARY / UIF / NET SALARY.` | |
| F10 | `UIF allocated only to UIF-registered individuals.` | |

### Period table

| Cell | Content |
|---|---|
| C13 | `FIRST FORTNIGHT — <DATE RANGE>` (merged C13:M13) |
| C14:M14 | Column headers (below) |
| C15 onward | One row per employee |
| next row | `TOTALS` (merged C:E) with sums in F, G, H, I, J, K, L, M |
| next row | `Source: <description of the period>` |

Column headers, in order C to M:

```
NAME | SURNAME | RATE | NORMAL HOURS | OVER TIME | TOTAL HOURS |
GROSS SALARY | OVERTIME | TOTAL SALARY | UIF | NET SALARY
```

Note: `OVER TIME` (column G) is **hours**. `OVERTIME` (column J) is **money**. They are different columns with near-identical labels — keep both exactly as written.

Employees with no recorded surname leave column D blank (see KUUX, JAHEIM in the real file).

### Second period on the same sheet (optional)

If the owner selects a range covering two pay periods, repeat the same table lower down under a `SECOND FORTNIGHT — <DATE RANGE>` heading, then add the summary block. For a single period, skip straight to the summary.

### Summary block

| Content | Notes |
|---|---|
| `<PERIOD> — MONTH SUMMARY` | merged across C:M |
| `Total salary — first fortnight` + value in F | |
| `Total salary — second fortnight` + value in F | only if two periods |
| `TOTAL SALARY — MONTH` + value in F | |
| `NET PAY — MONTH` + value in F | |
| `SARS DECLARATION` | merged across C:M |
| `UIF (employee + employer)` + value in F | **employee UIF total x 2** — employer matches 1:1 |
| `TOTALS` + value in F | |

Label cells in the summary are merged C:E, with the figure in F.

### Footer

`Prepared by: Nkutwala Construction  |  <PROJECT NAME>`

### Multi-period workbook

When exporting several periods at once, create one sheet per month named for the month (`SEPTEMBER 2026`), matching the existing consolidated workbook.

---

## EXPORT 2 — Expenses statement

Same house style. Same header and footer treatment, so the two exports look like a matched set.

### Header

| Cell | Content |
|---|---|
| C5 | `NKUTWALA CONSTRUCTION — EXPENSES STATEMENT` (merged C5:M5) |
| C6 | `<PROJECT NAME>  \|  <DATE RANGE>` (merged C6:M6) |

### Table

Headers from column C:

```
DATE | VENDOR | CATEGORY | DESCRIPTION | PAID BY | AMOUNT
```

- One row per **approved** expense in the date range. Pending expenses are excluded.
- `PAID BY` is either `Company` or `Owed to <employee name>`.
- Sorted by date ascending.
- `TOTALS` row with the amount sum.

### Summary blocks

**By category** — one row per category with its total:
```
Materials | Fuel | Plant hire | Consumables
```

**Reimbursements owed** — one row per employee who paid out of pocket, with the amount owed back to them, then a total. This is the number that has to reach them separately from wages.

**Grand total** — total approved expenses for the project in the period.

### Footer

`Prepared by: Nkutwala Construction  |  <PROJECT NAME>`

---

## What is explicitly NOT built

- No pay-run records, no pay-run state machine
- No pay-rules engine or configurable rule sets
- No holiday calendar or public-holiday table
- No PAYE, no tax tables, no payslips

The only deduction is UIF, because it is in the real spreadsheet. Nothing beyond it.
