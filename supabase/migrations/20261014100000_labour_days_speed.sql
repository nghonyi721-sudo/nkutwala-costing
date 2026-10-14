-- ===========================================================================
-- Speed fix: labour_days looks up each person's rate ONCE per day.
--
-- In 20261014090000 (payroll exports) labour_days was rebuilt with the pay
-- rule written in. Postgres folded its rate step into the final select and
-- then ran rate_on() for every place the rate is used (rate, ordinary pay,
-- overtime pay, total...) - about six lookups per person per day instead of
-- one. On a test set of 8,100 crew lines the dashboard went from ~5 s to
-- ~14 s (the old version had a window function that stopped the folding).
--
-- The fix: the rate comes from a LATERAL step with OFFSET 0, which Postgres
-- never folds in, so rate_on() runs once per person per day. Filters on the
-- person or the day can still reach the reports underneath.
--
-- Columns, types, figures and security are EXACTLY as in 20261014090000.
-- Nothing else changes. All-or-nothing.
-- ===========================================================================

begin;

create or replace view public.labour_days
with (security_invoker = true)
as
with days as (
  select
    r.company_id,
    c.employee_id,
    r.report_date                                              as day,
    sum(c.hours)                                               as total_hours,
    coalesce(sum(c.hours) filter (where r.all_overtime), 0)    as overtime_day_hours
  from public.daily_reports r
  join public.report_crew c on c.report_id = r.id
  where r.status = 'submitted'
    and c.hours > 0
  group by r.company_id, c.employee_id, r.report_date
),
split as (
  select
    d.*,
    rate.rate,
    least(d.total_hours - d.overtime_day_hours, 8)                               as ordinary_hours,
    greatest(d.total_hours - d.overtime_day_hours - 8, 0) + d.overtime_day_hours as ot_hours
  from days d
  -- OFFSET 0: worked out once per person per day (see the top of the file).
  cross join lateral (select public.rate_on(d.employee_id, d.day) as rate offset 0) rate
)
select
  s.company_id,
  s.employee_id,
  s.day,
  s.total_hours,
  s.rate,
  null::uuid                                                        as rule_id,
  s.ordinary_hours,
  s.ot_hours,
  0::numeric                                                        as premium_hours,
  null::text                                                        as premium_kind,
  1.5::numeric                                                      as ot_multiplier,
  null::numeric                                                     as premium_multiplier,
  round(s.ordinary_hours * s.rate, 2)                               as ordinary_pay,
  round(s.ot_hours * s.rate * 1.5, 2)                               as ot_pay,
  round(0 * s.rate, 2)                                              as premium_pay,
  round(s.ordinary_hours * s.rate, 2) + round(s.ot_hours * s.rate * 1.5, 2) as total_pay,
  s.overtime_day_hours
from split s
where (select public.current_user_role()) in ('owner', 'system_admin');

commit;

-- The SQL Editor shows this as the result.
select 'labour_days now looks up each rate once per person per day' as done;
