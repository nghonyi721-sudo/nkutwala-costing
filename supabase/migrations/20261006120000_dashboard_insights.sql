-- Dashboard insights: project health, spend vs budget over time, and where
-- the money goes. MONEY - owner/system_admin only, all of it.
--
-- Run once in the Supabase SQL Editor of the DEV project
-- (after 20261006090000_dashboard.sql).
--
-- Same rules as the Phase 6 dashboard functions:
--   * SECURITY INVOKER, read-only, explicit owner/system_admin check - anyone
--     else gets NOTHING back; logged-in users only.
--   * The dashboard screen does no cost arithmetic: every total, split and
--     percentage below is worked out here.
--   * Dates are report_date / receipt_date; weeks start on Monday; "today" is
--     South African time. p_project_id null = all projects.
-- scripts/rls-attack-test.mjs calls every function here as a site manager.
--
-- Wrapped in a transaction: if anything fails, nothing is applied.

begin;

-- ===========================================================================
-- 1. dashboard_projects - every project at a glance, worst first.
--    budget / spent_to_date / remaining / percent_used / unpriced_hours:
--    project to date. spent_in_range: the selected period.
--    health: 'over' (spent more than the budget), 'watch' (over 90%),
--    'on_track', or 'no_budget'. Lists active projects, plus any other
--    project that has a budget or costs.
-- ===========================================================================
create function public.dashboard_projects(p_from date, p_to date)
returns table (
  project_id     uuid,
  project_name   text,
  status         text,
  budget         numeric,
  spent_to_date  numeric,
  spent_in_range numeric,
  remaining      numeric,
  percent_used   numeric,
  unpriced_hours numeric,
  health         text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select x.*
  from (
    select
      p.id,
      p.name,
      p.status,
      b.amount,
      coalesce(so_far.amount, 0),
      coalesce(in_range.amount, 0),
      b.amount - coalesce(so_far.amount, 0),
      case when b.amount > 0 then round(100 * coalesce(so_far.amount, 0) / b.amount, 1) end,
      coalesce(unpriced.hours, 0),
      case
        when b.amount is null or b.amount = 0           then 'no_budget'
        when coalesce(so_far.amount, 0) > b.amount       then 'over'
        when 100 * coalesce(so_far.amount, 0) / b.amount > 90 then 'watch'
        else 'on_track'
      end
    from public.projects p
    left join (
      select pb.project_id, sum(pb.amount) as amount
      from public.project_budgets pb
      group by pb.project_id
    ) b on b.project_id = p.id
    left join (
      select l.project_id, sum(l.amount) as amount
      from public.project_cost_lines l
      where l.cost_date <= (now() at time zone 'Africa/Johannesburg')::date
      group by l.project_id
    ) so_far on so_far.project_id = p.id
    left join (
      select l.project_id, sum(l.amount) as amount
      from public.project_cost_lines l
      where l.cost_date between p_from and p_to
      group by l.project_id
    ) in_range on in_range.project_id = p.id
    left join (
      select u.project_id, sum(u.hours) as hours
      from public.unpriced_hours u
      group by u.project_id
    ) unpriced on unpriced.project_id = p.id
    where public.current_user_role() in ('owner', 'system_admin')
      and (p.status = 'active' or b.amount is not null or so_far.amount is not null)
  ) x (project_id, project_name, status, budget, spent_to_date, spent_in_range,
       remaining, percent_used, unpriced_hours, health)
  order by
    case x.health when 'over' then 0 when 'watch' then 1 when 'on_track' then 2 else 3 end,
    x.percent_used desc nulls last,
    x.project_name;
$$;

-- ===========================================================================
-- 2. dashboard_cumulative - spend vs budget over the whole job: one row per
--    week from the first cost to this week, with the running total and the
--    budget (the same on every row - the line it is heading for).
-- ===========================================================================
create function public.dashboard_cumulative(p_project_id uuid)
returns table (week_start date, spent numeric, cumulative_spent numeric, budget numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  with today as (
    select (now() at time zone 'Africa/Johannesburg')::date as d
  ),
  lines as (
    select l.cost_date, l.amount
    from public.project_cost_lines l
    where (p_project_id is null or l.project_id = p_project_id)
      and l.cost_date <= (select t.d from today t)
  ),
  weeks as (
    select generate_series(
             date_trunc('week', (select min(li.cost_date) from lines li)::timestamp),
             date_trunc('week', (select t.d from today t)::timestamp),
             interval '1 week')::date as week_start
  ),
  weekly as (
    select w.week_start, coalesce(sum(li.amount), 0) as spent
    from weeks w
    left join lines li on date_trunc('week', li.cost_date::timestamp)::date = w.week_start
    group by w.week_start
  ),
  budget as (
    select sum(pb.amount) as amount
    from public.project_budgets pb
    where p_project_id is null or pb.project_id = p_project_id
  )
  select
    wk.week_start,
    wk.spent,
    sum(wk.spent) over (order by wk.week_start),
    bg.amount
  from weekly wk
  cross join budget bg
  where public.current_user_role() in ('owner', 'system_admin')
  order by wk.week_start;
$$;

-- ===========================================================================
-- 3. dashboard_weekly_mix - spend per week in the range, split by where it
--    came from: labour, owned plant, receipts (VAT inclusive). Every week is
--    listed, R0 weeks included.
-- ===========================================================================
create function public.dashboard_weekly_mix(p_project_id uuid, p_from date, p_to date)
returns table (week_start date, labour numeric, owned_plant numeric, receipts numeric, total numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    w.week_start,
    coalesce(sum(l.amount) filter (where l.category = 'labour'), 0),
    coalesce(sum(l.amount) filter (where l.category = 'owned_plant'), 0),
    coalesce(sum(l.amount) filter (where l.receipt_id is not null), 0),
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
-- 4. dashboard_mix - where the money went in the range: three rows (labour,
--    owned plant, receipts), each with its amount and its percentage of the
--    period's total (null when nothing was spent).
-- ===========================================================================
create function public.dashboard_mix(p_project_id uuid, p_from date, p_to date)
returns table (source text, label text, sort_order integer, amount numeric, percent numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  with totals as (
    select
      coalesce(sum(l.amount) filter (where l.category = 'labour'), 0)       as labour,
      coalesce(sum(l.amount) filter (where l.category = 'owned_plant'), 0)  as owned_plant,
      coalesce(sum(l.amount) filter (where l.receipt_id is not null), 0)    as receipts,
      coalesce(sum(l.amount), 0)                                            as total
    from public.project_cost_lines l
    where (p_project_id is null or l.project_id = p_project_id)
      and l.cost_date between p_from and p_to
  )
  select
    s.source,
    s.label,
    s.sort_order,
    s.amount,
    case when t.total > 0 then round(100 * s.amount / t.total, 1) end
  from totals t
  cross join lateral (
    values
      ('labour',      'Labour',                  1, t.labour),
      ('owned_plant', 'Owned plant',             2, t.owned_plant),
      ('receipts',    'Receipts (incl. VAT)',    3, t.receipts)
  ) as s (source, label, sort_order, amount)
  where public.current_user_role() in ('owner', 'system_admin')
  order by s.sort_order;
$$;

-- ===========================================================================
-- 5. Permissions: logged-in users may call them (the check inside decides
--    who gets anything); anonymous visitors may not.
-- ===========================================================================
revoke execute on function
  public.dashboard_projects(date, date),
  public.dashboard_cumulative(uuid),
  public.dashboard_weekly_mix(uuid, date, date),
  public.dashboard_mix(uuid, date, date)
from public, anon;

grant execute on function
  public.dashboard_projects(date, date),
  public.dashboard_cumulative(uuid),
  public.dashboard_weekly_mix(uuid, date, date),
  public.dashboard_mix(uuid, date, date)
to authenticated;

commit;
