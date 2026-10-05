-- ===========================================================================
-- Phase 7a: exports - the export log and the data behind exports 1 and 2.
--
--   1. export_log: one row for every export the app makes - who, which
--      report, which filters, when. Anyone logged in can add their OWN row
--      (who and when are set by the database); only owners/admins can read
--      it. Never edited or deleted. Audited.
--   2. Read-only data functions for the Excel exports. Each one:
--      - is SECURITY INVOKER (the caller's own permissions and RLS apply);
--      - checks the caller is owner/system_admin (anyone else gets no rows);
--      - is built on the same views and functions as the dashboard
--        (project_cost_lines, unpriced_hours, dashboard_categories), so the
--        exports always match the dashboard;
--      - sends back its totals on every row (total_...): the app never adds
--        anything up, the files' totals rows carry the database's figures.
-- No existing tables or functions change. All-or-nothing.
-- ===========================================================================

begin;

-- ===========================================================================
-- 1. export_log
-- ===========================================================================
create table public.export_log (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null default public.current_user_company_id()
              references public.companies (id),
  -- Who exported: set by the database from the login (trigger below).
  user_id     uuid not null default auth.uid() references public.profiles (id),
  report_type text not null check (report_type in (
                'project_cost', 'payroll_hours', 'monthly_cost_pack', 'labour_return',
                'delay_register', 'safety_register', 'annual_earnings',
                'my_daily_report', 'my_labour_return')),
  -- The filters used, e.g. { "project_id": ..., "from": ..., "to": ... }
  filters     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index export_log_company_created_idx on public.export_log (company_id, created_at desc);

-- Who, which company and when always come from the database, never the app.
create function public.export_log_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.user_id    := auth.uid();
  new.company_id := public.current_user_company_id();
  new.created_at := now();
  return new;
end;
$$;

revoke execute on function public.export_log_before_insert() from public, anon, authenticated;

create trigger export_log_stamp
  before insert on public.export_log
  for each row execute function public.export_log_before_insert();

create trigger audit_export_log
  after insert or update or delete on public.export_log
  for each row execute function public.audit_row_change();

-- Add a row (report type and filters only). No updates, no deletes.
revoke all on public.export_log from anon, authenticated;
grant select on public.export_log to authenticated;
grant insert (report_type, filters) on public.export_log to authenticated;

alter table public.export_log enable row level security;

create policy "Owners and system admins read the export log"
  on public.export_log
  for select
  to authenticated
  using (
    (select public.current_user_role()) in ('owner', 'system_admin')
    and company_id = (select public.current_user_company_id())
  );

create policy "Logged-in users log their own exports"
  on public.export_log
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and company_id = (select public.current_user_company_id())
  );

-- ===========================================================================
-- 2. export_cost_summary - export 1, "Summary" sheet: per cost category,
--    the budget, spent in the period, spent to date, % of budget used (to
--    date) and unpriced hours in the period. The figures are the dashboard's
--    own (dashboard_categories), so the export matches the dashboard.
-- ===========================================================================
create function public.export_cost_summary(p_project_id uuid, p_from date, p_to date)
returns table (
  category              text,
  label                 text,
  sort_order            smallint,
  budget                numeric,
  spent_in_period       numeric,
  spent_to_date         numeric,
  percent_used          numeric,
  unpriced_hours        numeric,
  total_budget          numeric,
  total_spent_in_period numeric,
  total_spent_to_date   numeric,
  total_unpriced_hours  numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    c.category,
    c.label,
    c.sort_order,
    c.budget,
    c.spent_in_range,
    c.spent_to_date,
    c.percent_used,
    coalesce(u.hours, 0),
    sum(c.budget) over (),
    sum(c.spent_in_range) over (),
    sum(c.spent_to_date) over (),
    sum(coalesce(u.hours, 0)) over ()
  from public.dashboard_categories(p_project_id, p_from, p_to) c
  left join (
    select uh.category, sum(uh.hours) as hours
    from public.unpriced_hours uh
    where uh.report_date between p_from and p_to
      and (p_project_id is null or uh.project_id = p_project_id)
    group by uh.category
  ) u on u.category = c.category
  where public.current_user_role() in ('owner', 'system_admin')
  order by c.sort_order;
$$;

-- ===========================================================================
-- 3. export_labour - export 1, "Labour" sheet (and the basis of the payroll
--    sheet): per person in the period - days worked, hours (priced and
--    unpriced), each hourly rate applied WITH the date it started, cost.
--    Absent (0 h) lines don't count. approved: they have been approved (now
--    or before) - people never approved are always unpriced.
-- ===========================================================================
create function public.export_labour(p_project_id uuid, p_from date, p_to date)
returns table (
  employee_id          uuid,
  full_name            text,
  category             text,
  status               text,
  approved             boolean,
  days                 bigint,
  hours                numeric,
  priced_hours         numeric,
  unpriced_hours       numeric,
  rates                jsonb,
  cost                 numeric,
  total_hours          numeric,
  total_unpriced_hours numeric,
  total_cost           numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with lines as (
    -- Priced hours, with the rate row that priced them (the same row
    -- rate_on() picks: the latest live rate starting on or before the day).
    select
      l.employee_id,
      l.cost_date      as day,
      l.hours          as priced,
      0::numeric       as unpriced,
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
      and (p_project_id is null or l.project_id = p_project_id)

    union all

    select u.employee_id, u.report_date, 0::numeric, u.hours, 0::numeric, null::numeric, null::date
    from public.unpriced_hours u
    where u.category = 'labour'
      and u.report_date between p_from and p_to
      and (p_project_id is null or u.project_id = p_project_id)
  ),
  rates as (
    select x.employee_id, jsonb_agg(jsonb_build_object('rate', x.rate, 'from', x.effective_from) order by x.effective_from) as rates
    from (select distinct employee_id, rate, effective_from from lines where rate is not null) x
    group by x.employee_id
  )
  select
    x.employee_id,
    e.full_name,
    e.category,
    e.status,
    e.approved_at is not null,
    count(distinct x.day),
    sum(x.priced) + sum(x.unpriced),
    sum(x.priced),
    sum(x.unpriced),
    coalesce(r.rates, '[]'::jsonb),
    sum(x.amount),
    sum(sum(x.priced) + sum(x.unpriced)) over (),
    sum(sum(x.unpriced)) over (),
    sum(sum(x.amount)) over ()
  from lines x
  join public.employees e on e.id = x.employee_id
  left join rates r on r.employee_id = x.employee_id
  where public.current_user_role() in ('owner', 'system_admin')
  group by x.employee_id, e.full_name, e.category, e.status, e.approved_at, r.rates
  order by e.full_name;
$$;

-- ===========================================================================
-- 4. export_payroll - export 2, all projects: per person in the period.
--    included = they have been approved: they're on the payroll sheet.
--    Not included = never approved: they go on the "Excluded" sheet with
--    their hours, so nobody is silently dropped. Totals: gross and hours of
--    the included people; hours of the excluded people.
--    GROSS, FLAT RATE, BEFORE DEDUCTIONS AND OVERTIME - PROVISIONAL.
-- ===========================================================================
create function public.export_payroll(p_from date, p_to date)
returns table (
  employee_id          uuid,
  full_name            text,
  category             text,
  status               text,
  included             boolean,
  days                 bigint,
  hours                numeric,
  priced_hours         numeric,
  unpriced_hours       numeric,
  rates                jsonb,
  gross                numeric,
  total_hours          numeric,
  total_unpriced_hours numeric,
  total_gross          numeric,
  excluded_hours       numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    l.employee_id,
    l.full_name,
    l.category,
    l.status,
    l.approved,
    l.days,
    l.hours,
    l.priced_hours,
    l.unpriced_hours,
    l.rates,
    l.cost,
    coalesce(sum(l.hours) filter (where l.approved) over (), 0),
    coalesce(sum(l.unpriced_hours) filter (where l.approved) over (), 0),
    coalesce(sum(l.cost) filter (where l.approved) over (), 0),
    coalesce(sum(l.hours) filter (where not l.approved) over (), 0)
  from public.export_labour(null, p_from, p_to) l
  where public.current_user_role() in ('owner', 'system_admin')
  order by l.approved desc, l.full_name;
$$;

-- ===========================================================================
-- 5. export_daily_hours - export 2, "Daily grid": hours per person per day
--    on SUBMITTED reports (Absent days left out). included: as above.
-- ===========================================================================
create function public.export_daily_hours(p_project_id uuid, p_from date, p_to date)
returns table (
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
    and (p_project_id is null or r.project_id = p_project_id)
    and public.current_user_role() in ('owner', 'system_admin')
  group by c.employee_id, e.full_name, e.approved_at, r.report_date
  order by e.full_name, r.report_date;
$$;

-- ===========================================================================
-- 6. Permissions: logged-in users may call them (the check inside decides
--    who gets anything); anonymous visitors may not.
-- ===========================================================================
revoke execute on function
  public.export_cost_summary(uuid, date, date),
  public.export_labour(uuid, date, date),
  public.export_payroll(date, date),
  public.export_daily_hours(uuid, date, date)
from public, anon;

grant execute on function
  public.export_cost_summary(uuid, date, date),
  public.export_labour(uuid, date, date),
  public.export_payroll(date, date),
  public.export_daily_hours(uuid, date, date)
to authenticated;

commit;
