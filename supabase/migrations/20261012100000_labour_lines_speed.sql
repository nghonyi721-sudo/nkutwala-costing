-- ===========================================================================
-- Speed fix: labour_lines works out daily pay ONCE per query.
--
-- Every dashboard, drill-down and export function that reads labour (through
-- labour_lines -> project_cost_lines) took ~2 s even on tiny data, while the
-- same views queried directly took ~0.1 s. Inside a database function the
-- dates and project aren't known when the query is planned, and Postgres
-- picked a plan that recomputed everyone's daily pay (labour_days: the rate
-- on each day, the pay rules, overtime) again for every report line - four
-- such functions at once passed the 8-second statement limit.
--
-- The fix: labour_lines reads labour_days once, into a MATERIALIZED step
-- (day_pay), and the report lines once (lines); everything joins to those
-- saved results. A materialized step is worked out once per query whatever
-- plan Postgres picks.
--
-- The calculation, columns and security are EXACTLY as in 20261009090000
-- (8A-1): same rules, same rounding, the line with the most hours takes the
-- leftover cent, security invoker, owner/admin only. Views built on it
-- (project_cost_lines and everything after) are unchanged.
-- ===========================================================================

begin;

create or replace view public.labour_lines
with (security_invoker = true)
as
with day_pay as materialized (
  -- Each person's pay per day (all reports, all projects), worked out once.
  select * from public.labour_days
),
lines as materialized (
  select
    r.company_id,
    r.project_id,
    r.id          as report_id,
    r.report_date as day,
    c.id          as line_id,
    c.employee_id,
    c.hours,
    row_number() over (partition by c.employee_id, r.report_date order by c.hours desc, r.project_id, c.id) as rn
  from public.daily_reports r
  join public.report_crew c on c.report_id = r.id
  where r.status = 'submitted'
    and c.hours > 0
),
parts as (
  select
    l.*,
    d.rate,
    d.premium_kind,
    d.ordinary_hours as day_ordinary_hours,
    d.ot_hours       as day_ot_hours,
    d.premium_hours  as day_premium_hours,
    d.ordinary_pay   as day_ordinary_pay,
    d.ot_pay         as day_ot_pay,
    d.premium_pay    as day_premium_pay,
    round(d.ordinary_hours * l.hours / d.total_hours, 2) as part_ordinary_hours,
    round(d.ot_hours * l.hours / d.total_hours, 2)       as part_ot_hours,
    round(d.premium_hours * l.hours / d.total_hours, 2)  as part_premium_hours,
    round(d.ordinary_pay * l.hours / d.total_hours, 2)   as part_ordinary_pay,
    round(d.ot_pay * l.hours / d.total_hours, 2)         as part_ot_pay,
    round(d.premium_pay * l.hours / d.total_hours, 2)    as part_premium_pay
  from lines l
  join day_pay d on d.employee_id = l.employee_id and d.day = l.day
),
allocated as (
  select
    p.*,
    case when p.rn = 1 then p.day_ordinary_hours - (sum(p.part_ordinary_hours) over w - p.part_ordinary_hours)
         else p.part_ordinary_hours end as ordinary_hours,
    case when p.rn = 1 then p.day_ot_hours - (sum(p.part_ot_hours) over w - p.part_ot_hours)
         else p.part_ot_hours end as ot_hours,
    case when p.rn = 1 then p.day_premium_hours - (sum(p.part_premium_hours) over w - p.part_premium_hours)
         else p.part_premium_hours end as premium_hours,
    case when p.rn = 1 then p.day_ordinary_pay - (sum(p.part_ordinary_pay) over w - p.part_ordinary_pay)
         else p.part_ordinary_pay end as ordinary_pay,
    case when p.rn = 1 then p.day_ot_pay - (sum(p.part_ot_pay) over w - p.part_ot_pay)
         else p.part_ot_pay end as ot_pay,
    case when p.rn = 1 then p.day_premium_pay - (sum(p.part_premium_pay) over w - p.part_premium_pay)
         else p.part_premium_pay end as premium_pay
  from parts p
  window w as (partition by p.employee_id, p.day)
)
select
  a.company_id,
  a.project_id,
  a.report_id,
  a.day,
  a.line_id,
  a.employee_id,
  a.hours,
  a.rate,
  a.premium_kind,
  a.ordinary_hours,
  a.ot_hours,
  a.premium_hours,
  a.ordinary_pay,
  a.ot_pay,
  a.premium_pay,
  a.ordinary_pay + a.ot_pay + a.premium_pay as amount
from allocated a
where (select public.current_user_role()) in ('owner', 'system_admin');

commit;
