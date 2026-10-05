-- ===========================================================================
-- Exports: a project filter everywhere.
--
-- Every export can be filtered to one or more projects:
--   p_project_ids uuid[]  null = all projects; otherwise those projects.
--
--   All projects:      rows as before (labour: one row per person across all
--                      projects, with the names of the projects they worked on).
--   A list:            line items per project (labour: one row per person PER
--                      PROJECT - 8A's allocated pay, overtime split included).
--   Every row carries project_total_... (the subtotal of its project; with
--   all projects, the same as the grand total) and total_... (the grand
--   total): the app never adds anything up.
--
-- Each function is SECURITY INVOKER and built on the same views and
-- functions as the dashboard (project_cost_lines, unpriced_hours,
-- dashboard_categories, dashboard_weekly_mix, dashboard_period), so a file
-- filtered to a project matches the dashboard drill-down for that project.
-- Money: owner/system_admin only (the check is inside each function).
--
-- Site managers (database only - their screen comes in 7c):
--   my_report_projects()  the projects they have their own reports on
--   my_labour_return()    hours from their OWN submitted reports - names,
--                         categories and hours only, never a rand value.
--
-- No tables change. Old migrations are not edited: the four export
-- functions of 7a/8A-1 are replaced with new versions taking a project
-- list. All-or-nothing.
-- ===========================================================================

begin;

drop function public.export_payroll(date, date);
drop function public.export_labour(uuid, date, date);
drop function public.export_cost_summary(uuid, date, date);
drop function public.export_daily_hours(uuid, date, date);

-- ===========================================================================
-- 1. export_cost_summary - "Summary" sheet: per cost category the budget,
--    spent in the period, spent to date, % of budget used (to date) and
--    unpriced hours in the period. All projects: one block. A list: one
--    block per project, each exactly that project's dashboard figures.
-- ===========================================================================
create function public.export_cost_summary(p_project_ids uuid[], p_from date, p_to date)
returns table (
  project_id                    uuid,
  project_name                  text,
  category                      text,
  label                         text,
  sort_order                    smallint,
  budget                        numeric,
  spent_in_period               numeric,
  spent_to_date                 numeric,
  percent_used                  numeric,
  unpriced_hours                numeric,
  project_total_budget          numeric,
  project_total_spent_in_period numeric,
  project_total_spent_to_date   numeric,
  project_total_unpriced_hours  numeric,
  total_budget                  numeric,
  total_spent_in_period         numeric,
  total_spent_to_date           numeric,
  total_unpriced_hours          numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with scope as (
    -- null = all projects (one block); otherwise each chosen project the
    -- caller can see.
    select distinct s.project_id
    from unnest(coalesce(p_project_ids, array[null::uuid])) as s (project_id)
  )
  select
    s.project_id,
    p.name,
    c.category,
    c.label,
    c.sort_order,
    c.budget,
    c.spent_in_range,
    c.spent_to_date,
    c.percent_used,
    coalesce(u.hours, 0),
    sum(c.budget) over (partition by s.project_id),
    sum(c.spent_in_range) over (partition by s.project_id),
    sum(c.spent_to_date) over (partition by s.project_id),
    sum(coalesce(u.hours, 0)) over (partition by s.project_id),
    sum(c.budget) over (),
    sum(c.spent_in_range) over (),
    sum(c.spent_to_date) over (),
    sum(coalesce(u.hours, 0)) over ()
  from scope s
  left join public.projects p on p.id = s.project_id
  cross join lateral public.dashboard_categories(s.project_id, p_from, p_to) c
  left join lateral (
    select sum(uh.hours) as hours
    from public.unpriced_hours uh
    where uh.category = c.category
      and uh.report_date between p_from and p_to
      and (s.project_id is null or uh.project_id = s.project_id)
  ) u on true
  where (s.project_id is null or p.id is not null)
    and public.current_user_role() in ('owner', 'system_admin')
  order by p.name nulls first, s.project_id, c.sort_order;
$$;

-- ===========================================================================
-- 2. export_labour - "Labour" sheet (and the basis of the payroll sheet):
--    days worked, hours (priced and unpriced), the ordinary / overtime /
--    Sunday-holiday split, each hourly rate applied WITH the date it
--    started, and the cost.
--      All projects: one row per person; project_name = the projects they
--                    worked on, e.g. "Bridge B, Road A".
--      A list:       one row per person per project: that project's share
--                    of each day (labour_lines), overtime as allocated.
--    Absent (0 h) lines don't count. approved: approved now or before -
--    people never approved are always unpriced.
-- ===========================================================================
create function public.export_labour(p_project_ids uuid[], p_from date, p_to date)
returns table (
  project_id                   uuid,
  project_name                 text,
  employee_id                  uuid,
  full_name                    text,
  category                     text,
  status                       text,
  approved                     boolean,
  days                         bigint,
  hours                        numeric,
  priced_hours                 numeric,
  unpriced_hours               numeric,
  ordinary_hours               numeric,
  ot_hours                     numeric,
  premium_hours                numeric,
  rates                        jsonb,
  ordinary_pay                 numeric,
  ot_pay                       numeric,
  premium_pay                  numeric,
  cost                         numeric,
  project_total_hours          numeric,
  project_total_unpriced_hours numeric,
  project_total_ordinary_hours numeric,
  project_total_ot_hours       numeric,
  project_total_premium_hours  numeric,
  project_total_ordinary_pay   numeric,
  project_total_ot_pay         numeric,
  project_total_premium_pay    numeric,
  project_total_cost           numeric,
  total_hours                  numeric,
  total_unpriced_hours         numeric,
  total_ordinary_hours         numeric,
  total_ot_hours               numeric,
  total_premium_hours          numeric,
  total_ordinary_pay           numeric,
  total_ot_pay                 numeric,
  total_premium_pay            numeric,
  total_cost                   numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with lines as (
    -- Priced hours, with the rate row that priced them (the same row
    -- rate_on() picks: the latest live rate starting on or before the day).
    -- grp: the row's project when filtered; null (one row per person) for
    -- all projects.
    select
      case when p_project_ids is null then null::uuid else l.project_id end as grp,
      l.project_id,
      l.employee_id,
      l.cost_date      as day,
      l.hours          as priced,
      0::numeric       as unpriced,
      l.ordinary_hours as ordinary,
      l.ot_hours       as ot,
      l.premium_hours  as premium,
      l.amount - l.ot_amount - l.premium_amount as ordinary_pay,
      l.ot_amount      as ot_pay,
      l.premium_amount as premium_pay,
      l.amount,
      l.unit_rate      as rate,
      rr.effective_from
    from public.project_cost_lines l
    cross join lateral (
      select r.effective_from
      from public.employee_rates r
      where r.employee_id = l.employee_id
        and r.effective_from <= l.cost_date
        and r.voided_at is null
      order by r.effective_from desc
      limit 1
    ) rr
    where l.category = 'labour'
      and l.hours > 0
      and l.cost_date between p_from and p_to
      and (p_project_ids is null or l.project_id = any (p_project_ids))

    union all

    select
      case when p_project_ids is null then null::uuid else u.project_id end,
      u.project_id, u.employee_id, u.report_date, 0::numeric, u.hours,
      0::numeric, 0::numeric, 0::numeric, 0::numeric, 0::numeric, 0::numeric, 0::numeric,
      null::numeric, null::date
    from public.unpriced_hours u
    where u.category = 'labour'
      and u.report_date between p_from and p_to
      and (p_project_ids is null or u.project_id = any (p_project_ids))
  ),
  rates as (
    select x.grp, x.employee_id,
           jsonb_agg(jsonb_build_object('rate', x.rate, 'from', x.effective_from) order by x.effective_from) as rates
    from (select distinct grp, employee_id, rate, effective_from from lines where rate is not null) x
    group by x.grp, x.employee_id
  )
  select
    x.grp,
    string_agg(distinct p.name, ', ' order by p.name),
    x.employee_id,
    e.full_name,
    e.category,
    e.status,
    e.approved_at is not null,
    count(distinct x.day),
    sum(x.priced) + sum(x.unpriced),
    sum(x.priced),
    sum(x.unpriced),
    sum(x.ordinary),
    sum(x.ot),
    sum(x.premium),
    coalesce(r.rates, '[]'::jsonb),
    sum(x.ordinary_pay),
    sum(x.ot_pay),
    sum(x.premium_pay),
    sum(x.amount),
    sum(sum(x.priced) + sum(x.unpriced)) over (partition by x.grp),
    sum(sum(x.unpriced)) over (partition by x.grp),
    sum(sum(x.ordinary)) over (partition by x.grp),
    sum(sum(x.ot)) over (partition by x.grp),
    sum(sum(x.premium)) over (partition by x.grp),
    sum(sum(x.ordinary_pay)) over (partition by x.grp),
    sum(sum(x.ot_pay)) over (partition by x.grp),
    sum(sum(x.premium_pay)) over (partition by x.grp),
    sum(sum(x.amount)) over (partition by x.grp),
    sum(sum(x.priced) + sum(x.unpriced)) over (),
    sum(sum(x.unpriced)) over (),
    sum(sum(x.ordinary)) over (),
    sum(sum(x.ot)) over (),
    sum(sum(x.premium)) over (),
    sum(sum(x.ordinary_pay)) over (),
    sum(sum(x.ot_pay)) over (),
    sum(sum(x.premium_pay)) over (),
    sum(sum(x.amount)) over ()
  from lines x
  join public.employees e on e.id = x.employee_id
  join public.projects p on p.id = x.project_id
  left join rates r on r.grp is not distinct from x.grp and r.employee_id = x.employee_id
  where public.current_user_role() in ('owner', 'system_admin')
  group by x.grp, x.employee_id, e.full_name, e.category, e.status, e.approved_at, r.rates
  order by
    case when p_project_ids is null then null else min(p.name) end nulls first,
    x.grp,
    e.full_name;
$$;

-- ===========================================================================
-- 3. export_payroll - the payroll hours sheet.
--      All projects: each person's FULL pay - gross before deductions.
--      A list:       PROJECT LABOUR COST ALLOCATION - only those projects'
--                    share of each person's pay. Not the amount to pay.
--    included = approved (now or before): on the payroll sheet. Not
--    included = never approved: the "Excluded" sheet with their hours, so
--    nobody is silently dropped. Totals (per project and overall): the
--    included people's hours and pay; the excluded people's hours.
-- ===========================================================================
create function public.export_payroll(p_project_ids uuid[], p_from date, p_to date)
returns table (
  project_id                   uuid,
  project_name                 text,
  employee_id                  uuid,
  full_name                    text,
  category                     text,
  status                       text,
  included                     boolean,
  days                         bigint,
  hours                        numeric,
  priced_hours                 numeric,
  unpriced_hours               numeric,
  ordinary_hours               numeric,
  ot_hours                     numeric,
  premium_hours                numeric,
  rates                        jsonb,
  ordinary_pay                 numeric,
  ot_pay                       numeric,
  premium_pay                  numeric,
  gross                        numeric,
  project_total_hours          numeric,
  project_total_unpriced_hours numeric,
  project_total_ordinary_hours numeric,
  project_total_ot_hours       numeric,
  project_total_premium_hours  numeric,
  project_total_ordinary_pay   numeric,
  project_total_ot_pay         numeric,
  project_total_premium_pay    numeric,
  project_total_gross          numeric,
  project_excluded_hours       numeric,
  total_hours                  numeric,
  total_unpriced_hours         numeric,
  total_ordinary_hours         numeric,
  total_ot_hours               numeric,
  total_premium_hours          numeric,
  total_ordinary_pay           numeric,
  total_ot_pay                 numeric,
  total_premium_pay            numeric,
  total_gross                  numeric,
  excluded_hours               numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    l.project_id,
    l.project_name,
    l.employee_id,
    l.full_name,
    l.category,
    l.status,
    l.approved,
    l.days,
    l.hours,
    l.priced_hours,
    l.unpriced_hours,
    l.ordinary_hours,
    l.ot_hours,
    l.premium_hours,
    l.rates,
    l.ordinary_pay,
    l.ot_pay,
    l.premium_pay,
    l.cost,
    coalesce(sum(l.hours) filter (where l.approved) over (partition by l.project_id), 0),
    coalesce(sum(l.unpriced_hours) filter (where l.approved) over (partition by l.project_id), 0),
    coalesce(sum(l.ordinary_hours) filter (where l.approved) over (partition by l.project_id), 0),
    coalesce(sum(l.ot_hours) filter (where l.approved) over (partition by l.project_id), 0),
    coalesce(sum(l.premium_hours) filter (where l.approved) over (partition by l.project_id), 0),
    coalesce(sum(l.ordinary_pay) filter (where l.approved) over (partition by l.project_id), 0),
    coalesce(sum(l.ot_pay) filter (where l.approved) over (partition by l.project_id), 0),
    coalesce(sum(l.premium_pay) filter (where l.approved) over (partition by l.project_id), 0),
    coalesce(sum(l.cost) filter (where l.approved) over (partition by l.project_id), 0),
    coalesce(sum(l.hours) filter (where not l.approved) over (partition by l.project_id), 0),
    coalesce(sum(l.hours) filter (where l.approved) over (), 0),
    coalesce(sum(l.unpriced_hours) filter (where l.approved) over (), 0),
    coalesce(sum(l.ordinary_hours) filter (where l.approved) over (), 0),
    coalesce(sum(l.ot_hours) filter (where l.approved) over (), 0),
    coalesce(sum(l.premium_hours) filter (where l.approved) over (), 0),
    coalesce(sum(l.ordinary_pay) filter (where l.approved) over (), 0),
    coalesce(sum(l.ot_pay) filter (where l.approved) over (), 0),
    coalesce(sum(l.premium_pay) filter (where l.approved) over (), 0),
    coalesce(sum(l.cost) filter (where l.approved) over (), 0),
    coalesce(sum(l.hours) filter (where not l.approved) over (), 0)
  from public.export_labour(p_project_ids, p_from, p_to) l
  where public.current_user_role() in ('owner', 'system_admin')
  order by
    l.approved desc,
    case when p_project_ids is null then null else l.project_name end nulls first,
    l.project_id,
    l.full_name;
$$;

-- ===========================================================================
-- 4. export_daily_hours - the payroll sheet's "Daily grid": hours per
--    person per day on SUBMITTED reports (Absent days left out); per
--    project too when filtered (project_id null for all projects).
-- ===========================================================================
create function public.export_daily_hours(p_project_ids uuid[], p_from date, p_to date)
returns table (
  project_id  uuid,
  employee_id uuid,
  full_name   text,
  included    boolean,
  day         date,
  hours       numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    case when p_project_ids is null then null::uuid else r.project_id end,
    c.employee_id,
    e.full_name,
    e.approved_at is not null,
    r.report_date,
    sum(c.hours)
  from public.daily_reports r
  join public.report_crew c on c.report_id = r.id
  join public.employees e on e.id = c.employee_id
  where r.status = 'submitted'
    and c.hours > 0
    and r.report_date between p_from and p_to
    and (p_project_ids is null or r.project_id = any (p_project_ids))
    and public.current_user_role() in ('owner', 'system_admin')
  group by
    case when p_project_ids is null then null::uuid else r.project_id end,
    c.employee_id, e.full_name, e.approved_at, r.report_date
  order by e.full_name, r.report_date;
$$;

-- ===========================================================================
-- 5. export_receipts - "Receipts" sheet: approved receipts in the period
--    (the same rows as the drill-down's drill_receipts), with project
--    subtotals when filtered. Amounts are VAT inclusive.
-- ===========================================================================
create function public.export_receipts(p_project_ids uuid[], p_from date, p_to date)
returns table (
  receipt_id           uuid,
  receipt_date         date,
  vendor               text,
  category             text,
  category_label       text,
  amount               numeric,
  uploader_name        text,
  project_id           uuid,
  project_name         text,
  notes                text,
  project_total_amount numeric,
  total_amount         numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    l.receipt_id,
    l.cost_date,
    l.vendor,
    l.category,
    cc.label,
    l.amount,
    up.full_name,
    l.project_id,
    p.name,
    r.notes,
    sum(l.amount) over (partition by case when p_project_ids is null then null::uuid else l.project_id end),
    sum(l.amount) over ()
  from public.project_cost_lines l
  join public.receipts r on r.id = l.receipt_id
  join public.projects p on p.id = l.project_id
  join public.cost_categories cc on cc.code = l.category
  left join public.profiles up on up.id = r.uploader_id
  where l.receipt_id is not null
    and l.cost_date between p_from and p_to
    and (p_project_ids is null or l.project_id = any (p_project_ids))
    and public.current_user_role() in ('owner', 'system_admin')
  order by
    case when p_project_ids is null then null else p.name end nulls first,
    case when p_project_ids is null then null::uuid else l.project_id end nulls first,
    l.cost_date desc, l.vendor, l.receipt_id;
$$;

-- ===========================================================================
-- 6. export_weekly - "By week" sheet: spend per week (Monday start) by
--    kind, exactly the dashboard's weekly figures (dashboard_weekly_mix) -
--    for all projects, or per chosen project.
-- ===========================================================================
create function public.export_weekly(p_project_ids uuid[], p_from date, p_to date)
returns table (
  project_id                uuid,
  project_name              text,
  week_start                date,
  labour                    numeric,
  owned_plant               numeric,
  receipts                  numeric,
  total                     numeric,
  project_total_labour      numeric,
  project_total_owned_plant numeric,
  project_total_receipts    numeric,
  project_total_all         numeric,
  total_labour              numeric,
  total_owned_plant         numeric,
  total_receipts            numeric,
  total_all                 numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with scope as (
    select distinct s.project_id
    from unnest(coalesce(p_project_ids, array[null::uuid])) as s (project_id)
  )
  select
    s.project_id,
    p.name,
    w.week_start,
    w.labour,
    w.owned_plant,
    w.receipts,
    w.total,
    sum(w.labour) over (partition by s.project_id),
    sum(w.owned_plant) over (partition by s.project_id),
    sum(w.receipts) over (partition by s.project_id),
    sum(w.total) over (partition by s.project_id),
    sum(w.labour) over (),
    sum(w.owned_plant) over (),
    sum(w.receipts) over (),
    sum(w.total) over ()
  from scope s
  left join public.projects p on p.id = s.project_id
  cross join lateral public.dashboard_weekly_mix(s.project_id, p_from, p_to) w
  where (s.project_id is null or p.id is not null)
    and public.current_user_role() in ('owner', 'system_admin')
  order by p.name nulls first, s.project_id, w.week_start;
$$;

-- ===========================================================================
-- 7. export_period - a preset's dates (the dashboard's dashboard_period)
--    for the chosen projects. "To date" starts at the earliest first cost
--    among them. No rows for anyone but owners/admins.
-- ===========================================================================
create function public.export_period(p_preset text, p_project_ids uuid[])
returns table (from_date date, to_date date)
language sql
stable
security invoker
set search_path = ''
as $$
  select min(d.from_date), max(d.to_date)
  from unnest(coalesce(p_project_ids, array[null::uuid])) as s (project_id)
  cross join lateral public.dashboard_period(p_preset, s.project_id) d
  where public.current_user_role() in ('owner', 'system_admin')
  having count(*) > 0;
$$;

-- ===========================================================================
-- 8. my_report_projects - the projects the CALLER has their own reports on
--    (any status): what a site manager's export filter offers. Names only.
-- ===========================================================================
create function public.my_report_projects()
returns table (project_id uuid, project_name text, first_report date, last_report date)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.id, p.name, min(r.report_date), max(r.report_date)
  from public.daily_reports r
  join public.projects p on p.id = r.project_id
  where r.reporter_id = (select auth.uid())
  group by p.id, p.name
  order by p.name;
$$;

-- ===========================================================================
-- 9. my_labour_return - a site manager's labour return: hours per person
--    per day per project from the CALLER'S OWN SUBMITTED reports (Absent
--    days left out). QUANTITIES ONLY: names, categories and hours - never a
--    rate, cost or pay. A project they have no reports on returns nothing.
--    null = all their projects.
-- ===========================================================================
create function public.my_labour_return(p_project_ids uuid[], p_from date, p_to date)
returns table (
  project_id          uuid,
  project_name        text,
  report_id           uuid,
  report_date         date,
  employee_id         uuid,
  full_name           text,
  category            text,
  hours               numeric,
  project_total_hours numeric,
  total_hours         numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    r.project_id,
    p.name,
    r.id,
    r.report_date,
    c.employee_id,
    e.full_name,
    e.category,
    sum(c.hours),
    sum(sum(c.hours)) over (partition by r.project_id),
    sum(sum(c.hours)) over ()
  from public.daily_reports r
  join public.projects p on p.id = r.project_id
  join public.report_crew c on c.report_id = r.id
  join public.employees e on e.id = c.employee_id
  where r.reporter_id = (select auth.uid())
    and r.status = 'submitted'
    and c.hours > 0
    and r.report_date between p_from and p_to
    and (p_project_ids is null or r.project_id = any (p_project_ids))
  group by r.project_id, p.name, r.id, r.report_date, c.employee_id, e.full_name, e.category
  order by p.name, r.report_date, e.full_name;
$$;

-- ===========================================================================
-- 10. Permissions: logged-in users may call them (the checks inside decide
--     who gets anything); anonymous visitors may not.
-- ===========================================================================
revoke execute on function
  public.export_cost_summary(uuid[], date, date),
  public.export_labour(uuid[], date, date),
  public.export_payroll(uuid[], date, date),
  public.export_daily_hours(uuid[], date, date),
  public.export_receipts(uuid[], date, date),
  public.export_weekly(uuid[], date, date),
  public.export_period(text, uuid[]),
  public.my_report_projects(),
  public.my_labour_return(uuid[], date, date)
from public, anon;

grant execute on function
  public.export_cost_summary(uuid[], date, date),
  public.export_labour(uuid[], date, date),
  public.export_payroll(uuid[], date, date),
  public.export_daily_hours(uuid[], date, date),
  public.export_receipts(uuid[], date, date),
  public.export_weekly(uuid[], date, date),
  public.export_period(text, uuid[]),
  public.my_report_projects(),
  public.my_labour_return(uuid[], date, date)
to authenticated;

commit;
