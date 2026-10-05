-- Phase 6: owner dashboard. MONEY - owner/system_admin only, all of it.
--
-- Run once in the Supabase SQL Editor of the DEV project
-- (after 20261005120000_budgets_and_costing.sql).
--
-- The dashboard screen does NO cost arithmetic: every total, percentage,
-- sum and count it shows comes from one of these functions. The screen only
-- formats and draws what it's given.
--
-- Every function here is:
--   * SECURITY INVOKER - runs with the caller's own permissions, so all the
--     row rules on the tables and Phase 5 views underneath still apply;
--   * read-only (stable);
--   * gated by an explicit owner/system_admin check - anyone else gets
--     NOTHING back (no rows), not zeros;
--   * callable by logged-in users only, never anonymous visitors.
-- scripts/rls-attack-test.mjs calls every one of them as a site manager.
--
-- Dates: p_from / p_to are compared with report_date and receipt_date,
-- never created_at. Weeks start on Monday; "today" is South African time.
-- p_project_id null = all projects.
--
-- Wrapped in a transaction: if anything fails, nothing is applied.

begin;

-- ===========================================================================
-- 1. dashboard_period - the dates behind each preset.
--    project_to_date runs from the first cost (or unpriced hour) to today.
-- ===========================================================================
create function public.dashboard_period(p_preset text, p_project_id uuid default null)
returns table (from_date date, to_date date)
language sql
stable
security invoker
set search_path = ''
as $$
  with today as (
    select (now() at time zone 'Africa/Johannesburg')::date as d
  ),
  first_cost as (
    select least(
      (select min(l.cost_date) from public.project_cost_lines l
        where p_project_id is null or l.project_id = p_project_id),
      (select min(u.report_date) from public.unpriced_hours u
        where p_project_id is null or u.project_id = p_project_id)
    ) as d
  )
  select
    case p_preset
      when 'this_week'       then date_trunc('week', t.d::timestamp)::date
      when 'this_month'      then date_trunc('month', t.d::timestamp)::date
      when 'last_month'      then (date_trunc('month', t.d::timestamp) - interval '1 month')::date
      when 'project_to_date' then least(coalesce(f.d, t.d), t.d)
    end,
    case p_preset
      when 'last_month' then (date_trunc('month', t.d::timestamp) - interval '1 day')::date
      else t.d
    end
  from today t
  cross join first_cost f
  where p_preset in ('this_week', 'this_month', 'last_month', 'project_to_date')
    and public.current_user_role() in ('owner', 'system_admin');
$$;

-- ===========================================================================
-- 2. dashboard_summary - the headline numbers.
--    spent / unpriced_hours / missing_rate_items: inside the date range.
--    budget / spent_to_date / remaining / percent_used: project to date
--    (budgets cover the whole project). budget is null when none is set.
-- ===========================================================================
create function public.dashboard_summary(p_project_id uuid, p_from date, p_to date)
returns table (
  budget             numeric,
  spent              numeric,
  spent_to_date      numeric,
  remaining          numeric,
  percent_used       numeric,
  unpriced_hours     numeric,
  missing_rate_items bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    b.amount,
    coalesce(in_range.amount, 0),
    coalesce(so_far.amount, 0),
    b.amount - coalesce(so_far.amount, 0),
    case when b.amount > 0 then round(100 * coalesce(so_far.amount, 0) / b.amount, 1) end,
    coalesce(unpriced.hours, 0),
    coalesce(unpriced.items, 0)
  from
    (select sum(pb.amount) as amount
       from public.project_budgets pb
      where p_project_id is null or pb.project_id = p_project_id) b
  cross join
    (select sum(l.amount) as amount
       from public.project_cost_lines l
      where (p_project_id is null or l.project_id = p_project_id)
        and l.cost_date between p_from and p_to) in_range
  cross join
    (select sum(l.amount) as amount
       from public.project_cost_lines l
      where (p_project_id is null or l.project_id = p_project_id)
        and l.cost_date <= (now() at time zone 'Africa/Johannesburg')::date) so_far
  cross join
    (select sum(u.hours) as hours,
            count(distinct coalesce(u.employee_id, u.equipment_id)) as items
       from public.unpriced_hours u
      where (p_project_id is null or u.project_id = p_project_id)
        and u.report_date between p_from and p_to) unpriced
  where public.current_user_role() in ('owner', 'system_admin');
$$;

-- ===========================================================================
-- 3. dashboard_categories - budget vs actual, one row per category.
--    Bars compare spend to date with the budget; spent_in_range is the
--    selected period's share. warning = over 90% of budget.
-- ===========================================================================
create function public.dashboard_categories(p_project_id uuid, p_from date, p_to date)
returns table (
  category       text,
  label          text,
  sort_order     smallint,
  budget         numeric,
  spent_to_date  numeric,
  spent_in_range numeric,
  percent_used   numeric,
  warning        boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    cc.code,
    cc.label,
    cc.sort_order,
    b.amount,
    coalesce(so_far.amount, 0),
    coalesce(in_range.amount, 0),
    case when b.amount > 0 then round(100 * coalesce(so_far.amount, 0) / b.amount, 1) end,
    case when b.amount > 0 then 100 * coalesce(so_far.amount, 0) / b.amount > 90 else false end
  from public.cost_categories cc
  left join (
    select pb.category, sum(pb.amount) as amount
    from public.project_budgets pb
    where p_project_id is null or pb.project_id = p_project_id
    group by pb.category
  ) b on b.category = cc.code
  left join (
    select l.category, sum(l.amount) as amount
    from public.project_cost_lines l
    where (p_project_id is null or l.project_id = p_project_id)
      and l.cost_date <= (now() at time zone 'Africa/Johannesburg')::date
    group by l.category
  ) so_far on so_far.category = cc.code
  left join (
    select l.category, sum(l.amount) as amount
    from public.project_cost_lines l
    where (p_project_id is null or l.project_id = p_project_id)
      and l.cost_date between p_from and p_to
    group by l.category
  ) in_range on in_range.category = cc.code
  where public.current_user_role() in ('owner', 'system_admin')
  order by cc.sort_order;
$$;

-- ===========================================================================
-- 4. dashboard_weekly - spend per Monday-start week in the range. Every week
--    is listed, including weeks with nothing spent (R0).
-- ===========================================================================
create function public.dashboard_weekly(p_project_id uuid, p_from date, p_to date)
returns table (week_start date, spent numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    w.week_start,
    coalesce(sum(l.amount), 0)
  from (
    select generate_series(
             date_trunc('week', p_from::timestamp),
             date_trunc('week', p_to::timestamp),
             interval '1 week')::date as week_start
  ) w
  left join public.project_cost_lines l
    on date_trunc('week', l.cost_date::timestamp)::date = w.week_start
   and l.cost_date between p_from and p_to
   and (p_project_id is null or l.project_id = p_project_id)
  where public.current_user_role() in ('owner', 'system_admin')
  group by w.week_start
  order by w.week_start;
$$;

-- ===========================================================================
-- 5. dashboard_top_vendors - the 5 biggest vendors by APPROVED receipt spend
--    in the range. The same vendor typed differently counts once.
-- ===========================================================================
create function public.dashboard_top_vendors(p_project_id uuid, p_from date, p_to date)
returns table (vendor text, receipts bigint, amount numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    min(l.vendor),
    count(*),
    sum(l.amount)
  from public.project_cost_lines l
  join public.receipts r on r.id = l.receipt_id
  where l.receipt_id is not null
    and l.cost_date between p_from and p_to
    and (p_project_id is null or l.project_id = p_project_id)
    and public.current_user_role() in ('owner', 'system_admin')
  group by r.vendor_normalised
  order by sum(l.amount) desc, min(l.vendor)
  limit 5;
$$;

-- ===========================================================================
-- 6. dashboard_action_items - what's waiting, across all projects.
-- ===========================================================================
create function public.dashboard_action_items()
returns table (pending_receipts bigint, missing_rate_items bigint, unpriced_hours numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    (select count(*) from public.receipts r where r.status = 'submitted'),
    (select count(distinct coalesce(u.employee_id, u.equipment_id)) from public.unpriced_hours u),
    (select coalesce(sum(u.hours), 0) from public.unpriced_hours u)
  where public.current_user_role() in ('owner', 'system_admin');
$$;

-- ===========================================================================
-- 7. Employee hours calendar - SUBMITTED reports only.
--    employee_hours_by_day: one row per day with the reports behind it.
--    employee_month_summary: month totals, and labour cost at the flat rate -
--    PROVISIONAL, overtime rules not applied.
-- ===========================================================================
create function public.employee_hours_by_day(p_employee_id uuid, p_month date, p_project_id uuid default null)
returns table (day date, hours numeric, reports jsonb)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    r.report_date,
    sum(c.hours),
    jsonb_agg(
      jsonb_build_object('report_id', r.id, 'project_name', p.name, 'hours', c.hours)
      order by p.name
    )
  from public.daily_reports r
  join public.report_crew c on c.report_id = r.id
  join public.projects p on p.id = r.project_id
  where c.employee_id = p_employee_id
    and r.status = 'submitted'
    and r.report_date >= date_trunc('month', p_month::timestamp)::date
    and r.report_date < (date_trunc('month', p_month::timestamp) + interval '1 month')::date
    and (p_project_id is null or r.project_id = p_project_id)
    and public.current_user_role() in ('owner', 'system_admin')
  group by r.report_date
  order by r.report_date;
$$;

create function public.employee_month_summary(p_employee_id uuid, p_month date, p_project_id uuid default null)
returns table (total_hours numeric, provisional_cost numeric, unpriced_hours numeric, basis text)
language sql
stable
security invoker
set search_path = ''
as $$
  select m.total_hours, m.provisional_cost, m.unpriced_hours, m.basis
  from (
    select
      coalesce(sum(c.hours), 0)                                          as total_hours,
      coalesce(round(sum(c.hours * rate.hourly_rate), 2), 0)             as provisional_cost,
      coalesce(sum(c.hours) filter (where rate.hourly_rate is null), 0)  as unpriced_hours,
      'PROVISIONAL - overtime not applied'::text                         as basis
    from public.daily_reports r
    join public.report_crew c on c.report_id = r.id
    cross join lateral (select public.rate_on(c.employee_id, r.report_date) as hourly_rate) rate
    where c.employee_id = p_employee_id
      and r.status = 'submitted'
      and r.report_date >= date_trunc('month', p_month::timestamp)::date
      and r.report_date < (date_trunc('month', p_month::timestamp) + interval '1 month')::date
      and (p_project_id is null or r.project_id = p_project_id)
  ) m
  -- Outside the totals, so anyone else gets no row at all (not a row of zeros).
  where public.current_user_role() in ('owner', 'system_admin');
$$;

-- ===========================================================================
-- 8. Permissions: logged-in users may call them (the check inside decides
--    who gets anything); anonymous visitors may not.
-- ===========================================================================
revoke execute on function
  public.dashboard_period(text, uuid),
  public.dashboard_summary(uuid, date, date),
  public.dashboard_categories(uuid, date, date),
  public.dashboard_weekly(uuid, date, date),
  public.dashboard_top_vendors(uuid, date, date),
  public.dashboard_action_items(),
  public.employee_hours_by_day(uuid, date, uuid),
  public.employee_month_summary(uuid, date, uuid)
from public, anon;

grant execute on function
  public.dashboard_period(text, uuid),
  public.dashboard_summary(uuid, date, date),
  public.dashboard_categories(uuid, date, date),
  public.dashboard_weekly(uuid, date, date),
  public.dashboard_top_vendors(uuid, date, date),
  public.dashboard_action_items(),
  public.employee_hours_by_day(uuid, date, uuid),
  public.employee_month_summary(uuid, date, uuid)
to authenticated;

commit;
