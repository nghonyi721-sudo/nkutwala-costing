-- ===========================================================================
-- Phase 8A-2: what the pay rules screens and the overtime warnings need.
--
--   1. overtime_warnings: WARN ONLY, never block. For the dashboard and a
--      person's days:
--        day  - a person's total hours that day (all projects) over the
--               day limit (warn_daily_hours, 12 h);
--        week - a person's overtime hours Monday-Sunday over the week
--               limit (warn_weekly_ot_hours, 10 h). The whole week counts.
--      The limits of the pay rule in force on the day (for a week: on its
--      last worked day). SECURITY INVOKER, owner/system_admin only. Reads
--      daily pay through a MATERIALIZED step (see 20261012100000) so it
--      stays quick inside a function.
--   2. pay_rules_keep_first: the first pay rule can never be voided - every
--      day needs a rule. A separate trigger that runs before the others
--      (pay_rules_00_...), so its message is the one shown.
--
-- No pricing changes; the 8A-1 and 8B-1 rules are untouched. All-or-nothing.
-- ===========================================================================

begin;

-- ===========================================================================
-- 1. overtime_warnings
--      p_project_id: one project (only people who worked on it in the
--                    period - for a day warning, on that day) or null (all)
--      p_from/p_to:  the period; week warnings for every week it touches
--      p_employee_id: one person, or null for everyone
--    Rows: kind 'day' (day = that day, hours = the day's total hours) or
--    'week' (day = the week's Monday, hours = the week's overtime hours),
--    with limit_hours - the limit it is over.
-- ===========================================================================
create function public.overtime_warnings(p_project_id uuid, p_from date, p_to date, p_employee_id uuid default null)
returns table (
  employee_id   uuid,
  employee_name text,
  kind          text,
  day           date,
  hours         numeric,
  limit_hours   numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with day_pay as materialized (
    -- Daily hours and overtime for every week the period touches.
    select d.employee_id, d.day, d.total_hours, d.ot_hours, d.rule_id
    from public.labour_days d
    where d.day >= date_trunc('week', p_from::timestamp)::date
      and d.day < date_trunc('week', p_to::timestamp)::date + 7
      and (p_employee_id is null or d.employee_id = p_employee_id)
  ),
  -- Who worked on the chosen project, and when, in the period.
  on_project as (
    select distinct c.employee_id, r.report_date
    from public.daily_reports r
    join public.report_crew c on c.report_id = r.id
    where r.status = 'submitted'
      and c.hours > 0
      and r.report_date between p_from and p_to
      and (p_project_id is null or r.project_id = p_project_id)
  ),
  day_warnings as (
    select d.employee_id, 'day'::text as kind, d.day, d.total_hours as hours, pr.warn_daily_hours as limit_hours
    from day_pay d
    join public.pay_rules pr on pr.id = d.rule_id
    where d.day between p_from and p_to
      and d.total_hours > pr.warn_daily_hours
      and exists (select 1 from on_project o where o.employee_id = d.employee_id and o.report_date = d.day)
  ),
  weeks as (
    select
      d.employee_id,
      date_trunc('week', d.day::timestamp)::date                    as week_start,
      sum(d.ot_hours)                                               as hours,
      (array_agg(pr.warn_weekly_ot_hours order by d.day desc))[1]   as limit_hours
    from day_pay d
    join public.pay_rules pr on pr.id = d.rule_id
    group by d.employee_id, date_trunc('week', d.day::timestamp)::date
  ),
  week_warnings as (
    select w.employee_id, 'week'::text as kind, w.week_start as day, w.hours, w.limit_hours
    from weeks w
    where w.hours > w.limit_hours
      and exists (
        select 1 from on_project o
        where o.employee_id = w.employee_id
          and o.report_date between w.week_start and w.week_start + 6
      )
  )
  select x.employee_id, e.full_name, x.kind, x.day, x.hours, x.limit_hours
  from (
    select * from day_warnings
    union all
    select * from week_warnings
  ) x
  join public.employees e on e.id = x.employee_id
  where public.current_user_role() in ('owner', 'system_admin')
  order by x.day, x.kind desc, e.full_name;
$$;

revoke execute on function public.overtime_warnings(uuid, date, date, uuid) from public, anon;
grant execute on function public.overtime_warnings(uuid, date, date, uuid) to authenticated;

-- ===========================================================================
-- 2. The first pay rule can never be voided: every day needs a rule. A rule
--    can only be voided while another live rule starts on or before its
--    date (the days then fall back to that one).
-- ===========================================================================
create function public.pay_rules_keep_first()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.voided_at is null
     and new.void_reason is distinct from old.void_reason
     and not exists (
       select 1
       from public.pay_rules p
       where p.company_id = old.company_id
         and p.voided_at is null
         and p.id <> old.id
         and p.effective_from <= old.effective_from
     ) then
    raise exception 'The first pay rule can''t be voided - every day needs a rule. Add a new rule from a date instead.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke execute on function public.pay_rules_keep_first() from public, anon, authenticated;

-- "00" so it runs before pay_rules_0_period_lock and pay_rules_rules.
create trigger pay_rules_00_keep_first
  before update on public.pay_rules
  for each row execute function public.pay_rules_keep_first();

commit;
