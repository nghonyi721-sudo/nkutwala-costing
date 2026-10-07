-- ===========================================================================
-- Phase 8B-2: what the pay run screens and the pay-run Excel need.
--
--   1. pay_run_allocations: the run's PROJECT SPLIT, frozen at close like the
--      rest of the snapshot - per run, person, day and project: hours and
--      pay (8A's labour_lines: each project's share of the person's day,
--      overtime included). The project-filtered pay-run file is built from
--      it. Owner/admin read only, written only by close_pay_period, never
--      changed, audited. Runs closed before this file have no split (their
--      filtered file says so); nothing is filled in for them.
--   2. pay_period_close_days: the days a close saves - 8B-1's rules,
--      unchanged, in a function of their own. close_pay_period is rebuilt on
--      it (and now also saves the split); the preview uses it too, so the
--      preview always equals what closing saves.
--   3. Read functions for the screens and the Excel (SECURITY INVOKER,
--      owner/system_admin only, totals on every row - the app adds nothing
--      up): pay_period_overview (view), pay_period_preview, pay_run_versions,
--      pay_run_people, pay_run_grid, pay_run_projects, pay_outstanding_people.
--   4. export_log accepts 'pay_run'.
--
-- close_pay_period stays SECURITY DEFINER for the reason in 8B-1 (it writes
-- the snapshot, which the app may not write), with the same role and
-- company checks. Everything new is SECURITY INVOKER. Site managers get
-- nothing. No pricing changes. All-or-nothing.
-- ===========================================================================

begin;

-- ===========================================================================
-- 1. pay_run_allocations - the run's project split
-- ===========================================================================
create table public.pay_run_allocations (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies (id),
  run_id         uuid not null references public.pay_runs (id),
  employee_id    uuid not null references public.employees (id),
  day            date not null,
  project_id     uuid not null references public.projects (id),
  -- The project's name as it was when the run was closed.
  project_name   text not null,
  -- As pay_run_days.included: paid in this run, or excluded (pending).
  included       boolean not null,
  hours          numeric not null,
  ordinary_hours numeric,
  ot_hours       numeric,
  premium_hours  numeric,
  ordinary_pay   numeric,
  ot_pay         numeric,
  premium_pay    numeric,
  amount         numeric,
  constraint pay_run_allocations_one unique (run_id, employee_id, day, project_id)
);

create index pay_run_allocations_run_project_idx on public.pay_run_allocations (run_id, project_id);

create trigger audit_pay_run_allocations
  after insert or update or delete on public.pay_run_allocations
  for each row execute function public.audit_row_change();

revoke all on public.pay_run_allocations from anon, authenticated;
grant select on public.pay_run_allocations to authenticated;

alter table public.pay_run_allocations enable row level security;

create policy "Owners and system admins read pay run allocations"
  on public.pay_run_allocations
  for select
  to authenticated
  using (
    (select public.current_user_role()) in ('owner', 'system_admin')
    and company_id = (select public.current_user_company_id())
  );

-- ===========================================================================
-- 2. pay_period_close_days - the days closing this period would save.
--    8B-1's rules: every day in the period (priced = paid, unpriced =
--    excluded, i.e. pending people), plus LATE days - priced days in
--    earlier closed periods - and never a day an active run already paid.
-- ===========================================================================
create function public.pay_period_close_days(p_period_id uuid)
returns table (
  employee_id    uuid,
  day            date,
  included       boolean,
  late           boolean,
  total_hours    numeric,
  ordinary_hours numeric,
  ot_hours       numeric,
  premium_hours  numeric,
  rate           numeric,
  rate_from      date,
  ordinary_pay   numeric,
  ot_pay         numeric,
  premium_pay    numeric,
  total_pay      numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    d.employee_id,
    d.day,
    d.rate is not null,
    d.day < pp.start_date,
    d.total_hours,
    d.ordinary_hours,
    d.ot_hours,
    d.premium_hours,
    d.rate,
    (select r.effective_from from public.employee_rates r
      where r.employee_id = d.employee_id and r.effective_from <= d.day and r.voided_at is null
      order by r.effective_from desc limit 1),
    d.ordinary_pay,
    d.ot_pay,
    d.premium_pay,
    d.total_pay
  from public.pay_periods pp
  join public.labour_days d on d.company_id = pp.company_id
  where pp.id = p_period_id
    and public.current_user_role() in ('owner', 'system_admin')
    and not exists (
      select 1
      from public.pay_run_days x
      join public.pay_runs r on r.id = x.run_id
      where r.status = 'active'
        and x.included
        and x.employee_id = d.employee_id
        and x.day = d.day
    )
    and (
      d.day between pp.start_date and pp.end_date
      or (
        d.day < pp.start_date
        and d.rate is not null
        and exists (
          select 1 from public.pay_periods q
          where q.company_id = pp.company_id
            and q.status in ('closed', 'paid')
            and d.day between q.start_date and q.end_date
        )
      )
    );
$$;

-- ===========================================================================
-- 3. close_pay_period - as in 8B-1 (same checks, same days, same lines),
--    built on pay_period_close_days, and now also saving the project split.
--    SECURITY DEFINER: it writes the snapshot, which the app may not write.
-- ===========================================================================
create or replace function public.close_pay_period(p_period_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company  uuid := public.current_user_company_id();
  v_period   public.pay_periods;
  v_run      uuid;
  v_version  integer;
  v_drafts   integer;
  v_unpriced integer;
begin
  if coalesce(public.current_user_role() in ('owner', 'system_admin'), false) is false then
    raise exception 'Only the owner can close a pay period.' using errcode = '42501';
  end if;

  select * into v_period
  from public.pay_periods
  where id = p_period_id and company_id = v_company
  for update;
  if not found then
    raise exception 'Pay period not found.' using errcode = '23514';
  end if;
  if v_period.status not in ('open', 'reopened') then
    raise exception 'This pay period is already closed.' using errcode = '23514';
  end if;

  select
    count(*) filter (where b.kind = 'draft_report'),
    count(*) filter (where b.kind = 'unpriced_hours')
  into v_drafts, v_unpriced
  from public.pay_period_blockers(p_period_id) b;
  if v_drafts > 0 or v_unpriced > 0 then
    raise exception 'Closing is blocked: % draft report(s) and % day(s) of unpriced hours in this period. Fix them first.',
      v_drafts, v_unpriced using errcode = '23514';
  end if;

  select coalesce(max(version), 0) + 1 into v_version from public.pay_runs where period_id = p_period_id;
  insert into public.pay_runs (company_id, period_id, version, closed_by, closed_at)
  values (v_company, p_period_id, v_version, auth.uid(), now())
  returning id into v_run;

  -- The days (the same list the preview shows).
  insert into public.pay_run_days (
    company_id, run_id, employee_id, day, included, late, total_hours, ordinary_hours, ot_hours,
    premium_hours, rate, rate_from, ordinary_pay, ot_pay, premium_pay, total_pay
  )
  select
    v_company, v_run, c.employee_id, c.day, c.included, c.late, c.total_hours, c.ordinary_hours,
    c.ot_hours, c.premium_hours, c.rate, c.rate_from, c.ordinary_pay, c.ot_pay, c.premium_pay, c.total_pay
  from public.pay_period_close_days(p_period_id) c;

  -- The lines: per person, paid (included) and excluded separately.
  insert into public.pay_run_lines (
    company_id, run_id, employee_id, employee_name, employee_category, included, days, hours,
    late_hours, ordinary_hours, ot_hours, premium_hours, rates, ordinary_pay, ot_pay, premium_pay, gross
  )
  select
    v_company, v_run, x.employee_id, e.full_name, e.category, x.included,
    count(*), sum(x.total_hours),
    coalesce(sum(x.total_hours) filter (where x.late), 0),
    sum(x.ordinary_hours), sum(x.ot_hours), sum(x.premium_hours),
    coalesce(
      (select jsonb_agg(jsonb_build_object('rate', rr.rate, 'from', rr.rate_from) order by rr.rate_from)
         from (select distinct y.rate, y.rate_from
                 from public.pay_run_days y
                where y.run_id = v_run and y.employee_id = x.employee_id and y.rate is not null) rr),
      '[]'::jsonb),
    sum(x.ordinary_pay), sum(x.ot_pay), sum(x.premium_pay), sum(x.total_pay)
  from public.pay_run_days x
  join public.employees e on e.id = x.employee_id
  where x.run_id = v_run
  group by x.employee_id, e.full_name, e.category, x.included;

  -- The project split of every day saved above: each project's share of
  -- the person's day (labour_lines - the split the dashboard uses).
  insert into public.pay_run_allocations (
    company_id, run_id, employee_id, day, project_id, project_name, included, hours,
    ordinary_hours, ot_hours, premium_hours, ordinary_pay, ot_pay, premium_pay, amount
  )
  select
    v_company, v_run, l.employee_id, l.day, l.project_id, p.name, x.included,
    sum(l.hours), sum(l.ordinary_hours), sum(l.ot_hours), sum(l.premium_hours),
    sum(l.ordinary_pay), sum(l.ot_pay), sum(l.premium_pay), sum(l.amount)
  from public.pay_run_days x
  join public.labour_lines l on l.employee_id = x.employee_id and l.day = x.day
  join public.projects p on p.id = l.project_id
  where x.run_id = v_run
  group by l.employee_id, l.day, l.project_id, p.name, x.included;

  update public.pay_periods
  set status = 'closed', closed_by = auth.uid(), closed_at = now()
  where id = p_period_id;

  return v_run;
end;
$$;

-- ===========================================================================
-- 4. pay_period_overview - the pay runs list: every period with its active
--    run's figures (from the snapshot).
-- ===========================================================================
create view public.pay_period_overview
with (security_invoker = true)
as
select
  pp.id,
  pp.company_id,
  pp.start_date,
  pp.end_date,
  pp.status,
  pp.notes,
  pp.created_at,
  pp.closed_at,
  cb.full_name    as closed_by_name,
  pp.paid_at,
  pp.paid_on,
  pb.full_name    as paid_by_name,
  pp.reopened_at,
  rb.full_name    as reopened_by_name,
  pp.reopen_reason,
  r.id            as run_id,
  r.version,
  (select count(*) from public.pay_runs v where v.period_id = pp.id) as versions,
  lines.people,
  lines.hours,
  lines.gross,
  lines.excluded_people,
  lines.excluded_hours
from public.pay_periods pp
left join public.pay_runs r on r.period_id = pp.id and r.status = 'active'
left join lateral (
  select
    count(*) filter (where l.included)              as people,
    sum(l.hours) filter (where l.included)          as hours,
    sum(l.gross) filter (where l.included)          as gross,
    count(*) filter (where not l.included)          as excluded_people,
    sum(l.hours) filter (where not l.included)      as excluded_hours
  from public.pay_run_lines l
  where l.run_id = r.id
) lines on true
left join public.profiles cb on cb.id = pp.closed_by
left join public.profiles pb on pb.id = pp.paid_by
left join public.profiles rb on rb.id = pp.reopened_by
where (select public.current_user_role()) in ('owner', 'system_admin');

revoke all on public.pay_period_overview from anon, authenticated;
grant select on public.pay_period_overview to authenticated;

-- ===========================================================================
-- 5. pay_period_preview - what closing would save, per person (exactly the
--    lines close_pay_period writes, from the same days). Totals: the paid
--    people (included); excluded = pending people, hours only.
-- ===========================================================================
create function public.pay_period_preview(p_period_id uuid)
returns table (
  employee_id          uuid,
  employee_name        text,
  employee_category    text,
  employee_status      text,
  included             boolean,
  days                 bigint,
  hours                numeric,
  late_hours           numeric,
  ordinary_hours       numeric,
  ot_hours             numeric,
  premium_hours        numeric,
  rates                jsonb,
  ordinary_pay         numeric,
  ot_pay               numeric,
  premium_pay          numeric,
  gross                numeric,
  total_people         bigint,
  total_hours          numeric,
  total_late_hours     numeric,
  total_ordinary_hours numeric,
  total_ot_hours       numeric,
  total_premium_hours  numeric,
  total_ordinary_pay   numeric,
  total_ot_pay         numeric,
  total_premium_pay    numeric,
  total_gross          numeric,
  excluded_people      bigint,
  excluded_hours       numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with days as (
    select * from public.pay_period_close_days(p_period_id)
  ),
  people as (
    select
      x.employee_id,
      x.included,
      count(*)                                               as days,
      sum(x.total_hours)                                     as hours,
      coalesce(sum(x.total_hours) filter (where x.late), 0)  as late_hours,
      sum(x.ordinary_hours)                                  as ordinary_hours,
      sum(x.ot_hours)                                        as ot_hours,
      sum(x.premium_hours)                                   as premium_hours,
      coalesce(
        (select jsonb_agg(jsonb_build_object('rate', rr.rate, 'from', rr.rate_from) order by rr.rate_from)
           from (select distinct y.rate, y.rate_from
                   from days y
                  where y.employee_id = x.employee_id and y.rate is not null) rr),
        '[]'::jsonb)                                         as rates,
      sum(x.ordinary_pay)                                    as ordinary_pay,
      sum(x.ot_pay)                                          as ot_pay,
      sum(x.premium_pay)                                     as premium_pay,
      sum(x.total_pay)                                       as gross
    from days x
    group by x.employee_id, x.included
  )
  select
    p.employee_id,
    e.full_name,
    e.category,
    e.status,
    p.included,
    p.days,
    p.hours,
    p.late_hours,
    p.ordinary_hours,
    p.ot_hours,
    p.premium_hours,
    p.rates,
    p.ordinary_pay,
    p.ot_pay,
    p.premium_pay,
    p.gross,
    count(*) filter (where p.included) over (),
    coalesce(sum(p.hours) filter (where p.included) over (), 0),
    coalesce(sum(p.late_hours) filter (where p.included) over (), 0),
    coalesce(sum(p.ordinary_hours) filter (where p.included) over (), 0),
    coalesce(sum(p.ot_hours) filter (where p.included) over (), 0),
    coalesce(sum(p.premium_hours) filter (where p.included) over (), 0),
    coalesce(sum(p.ordinary_pay) filter (where p.included) over (), 0),
    coalesce(sum(p.ot_pay) filter (where p.included) over (), 0),
    coalesce(sum(p.premium_pay) filter (where p.included) over (), 0),
    coalesce(sum(p.gross) filter (where p.included) over (), 0),
    count(*) filter (where not p.included) over (),
    coalesce(sum(p.hours) filter (where not p.included) over (), 0)
  from people p
  join public.employees e on e.id = p.employee_id
  where public.current_user_role() in ('owner', 'system_admin')
  order by p.included desc, e.full_name;
$$;

-- ===========================================================================
-- 6. pay_run_versions - a period's runs (v1, v2...), newest first, with who
--    closed / paid / superseded them and each version's figures.
--    has_split: the run's project split was saved (closed after 8B-2).
-- ===========================================================================
create function public.pay_run_versions(p_period_id uuid)
returns table (
  run_id            uuid,
  version           integer,
  status            text,
  closed_at         timestamptz,
  closed_by_name    text,
  paid_at           timestamptz,
  paid_on           date,
  paid_by_name      text,
  superseded_at     timestamptz,
  superseded_by_name text,
  superseded_reason text,
  people            bigint,
  hours             numeric,
  gross             numeric,
  excluded_people   bigint,
  has_split         boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    r.id,
    r.version,
    r.status,
    r.closed_at,
    cb.full_name,
    r.paid_at,
    r.paid_on,
    pb.full_name,
    r.superseded_at,
    sb.full_name,
    r.superseded_reason,
    (select count(*) from public.pay_run_lines l where l.run_id = r.id and l.included),
    (select sum(l.hours) from public.pay_run_lines l where l.run_id = r.id and l.included),
    (select sum(l.gross) from public.pay_run_lines l where l.run_id = r.id and l.included),
    (select count(*) from public.pay_run_lines l where l.run_id = r.id and not l.included),
    exists (select 1 from public.pay_run_allocations a where a.run_id = r.id)
  from public.pay_runs r
  left join public.profiles cb on cb.id = r.closed_by
  left join public.profiles pb on pb.id = r.paid_by
  left join public.profiles sb on sb.id = r.superseded_by
  where r.period_id = p_period_id
    and public.current_user_role() in ('owner', 'system_admin')
  order by r.version desc;
$$;

-- ===========================================================================
-- 7. pay_run_people - a run's lines, for its screen and the pay-run Excel.
--      null (all projects): each person's FULL pay, from pay_run_lines;
--                           project_name = the projects they worked on.
--      a list:              each person's share PER PROJECT (the frozen
--                           split) - a PROJECT LABOUR COST ALLOCATION.
--    Names and categories as they were at close. Totals: the paid people
--    (per project and overall); excluded = pending people's hours.
-- ===========================================================================
create function public.pay_run_people(p_run_id uuid, p_project_ids uuid[])
returns table (
  project_id                   uuid,
  project_name                 text,
  employee_id                  uuid,
  employee_name                text,
  employee_category            text,
  included                     boolean,
  days                         bigint,
  hours                        numeric,
  late_hours                   numeric,
  ordinary_hours               numeric,
  ot_hours                     numeric,
  premium_hours                numeric,
  rates                        jsonb,
  ordinary_pay                 numeric,
  ot_pay                       numeric,
  premium_pay                  numeric,
  gross                        numeric,
  project_total_hours          numeric,
  project_total_late_hours     numeric,
  project_total_ordinary_hours numeric,
  project_total_ot_hours       numeric,
  project_total_premium_hours  numeric,
  project_total_ordinary_pay   numeric,
  project_total_ot_pay         numeric,
  project_total_premium_pay    numeric,
  project_total_gross          numeric,
  project_excluded_hours       numeric,
  total_people                 bigint,
  total_hours                  numeric,
  total_late_hours             numeric,
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
  with run as (
    select r.id, pp.start_date
    from public.pay_runs r
    join public.pay_periods pp on pp.id = r.period_id
    where r.id = p_run_id
  ),
  -- All projects: the frozen per-person lines.
  full_pay as (
    select
      null::uuid as project_id,
      (select string_agg(distinct a.project_name, ', ' order by a.project_name)
         from public.pay_run_allocations a
        where a.run_id = l.run_id and a.employee_id = l.employee_id) as project_name,
      l.employee_id, l.employee_name, l.employee_category, l.included,
      l.days::bigint as days, l.hours, l.late_hours, l.ordinary_hours, l.ot_hours, l.premium_hours,
      l.rates, l.ordinary_pay, l.ot_pay, l.premium_pay, l.gross
    from public.pay_run_lines l
    where l.run_id = p_run_id
      and p_project_ids is null
  ),
  -- Chosen projects: the frozen split, per person per project.
  split as (
    select
      a.project_id,
      a.project_name,
      a.employee_id,
      l.employee_name,
      l.employee_category,
      a.included,
      count(*)::bigint                                                  as days,
      sum(a.hours)                                                      as hours,
      coalesce(sum(a.hours) filter (where a.day < run.start_date), 0)   as late_hours,
      sum(a.ordinary_hours)                                             as ordinary_hours,
      sum(a.ot_hours)                                                   as ot_hours,
      sum(a.premium_hours)                                              as premium_hours,
      coalesce(
        (select jsonb_agg(jsonb_build_object('rate', rr.rate, 'from', rr.rate_from) order by rr.rate_from)
           from (select distinct d.rate, d.rate_from
                   from public.pay_run_days d
                   join public.pay_run_allocations b
                     on b.run_id = d.run_id and b.employee_id = d.employee_id and b.day = d.day
                  where d.run_id = p_run_id
                    and d.employee_id = a.employee_id
                    and b.project_id = a.project_id
                    and d.rate is not null) rr),
        '[]'::jsonb)                                                    as rates,
      sum(a.ordinary_pay)                                               as ordinary_pay,
      sum(a.ot_pay)                                                     as ot_pay,
      sum(a.premium_pay)                                                as premium_pay,
      sum(a.amount)                                                     as gross
    from public.pay_run_allocations a
    cross join run
    join public.pay_run_lines l
      on l.run_id = a.run_id and l.employee_id = a.employee_id and l.included = a.included
    where a.run_id = p_run_id
      and p_project_ids is not null
      and a.project_id = any (p_project_ids)
    group by a.project_id, a.project_name, a.employee_id, l.employee_name, l.employee_category, a.included
  ),
  run_lines as (
    select * from full_pay
    union all
    select * from split
  )
  select
    x.project_id,
    x.project_name,
    x.employee_id,
    x.employee_name,
    x.employee_category,
    x.included,
    x.days,
    x.hours,
    x.late_hours,
    x.ordinary_hours,
    x.ot_hours,
    x.premium_hours,
    x.rates,
    x.ordinary_pay,
    x.ot_pay,
    x.premium_pay,
    x.gross,
    coalesce(sum(x.hours) filter (where x.included) over (partition by x.project_id), 0),
    coalesce(sum(x.late_hours) filter (where x.included) over (partition by x.project_id), 0),
    coalesce(sum(x.ordinary_hours) filter (where x.included) over (partition by x.project_id), 0),
    coalesce(sum(x.ot_hours) filter (where x.included) over (partition by x.project_id), 0),
    coalesce(sum(x.premium_hours) filter (where x.included) over (partition by x.project_id), 0),
    coalesce(sum(x.ordinary_pay) filter (where x.included) over (partition by x.project_id), 0),
    coalesce(sum(x.ot_pay) filter (where x.included) over (partition by x.project_id), 0),
    coalesce(sum(x.premium_pay) filter (where x.included) over (partition by x.project_id), 0),
    coalesce(sum(x.gross) filter (where x.included) over (partition by x.project_id), 0),
    coalesce(sum(x.hours) filter (where not x.included) over (partition by x.project_id), 0),
    -- People, not rows: someone on two projects is one person.
    (select count(distinct y.employee_id) from run_lines y where y.included),
    coalesce(sum(x.hours) filter (where x.included) over (), 0),
    coalesce(sum(x.late_hours) filter (where x.included) over (), 0),
    coalesce(sum(x.ordinary_hours) filter (where x.included) over (), 0),
    coalesce(sum(x.ot_hours) filter (where x.included) over (), 0),
    coalesce(sum(x.premium_hours) filter (where x.included) over (), 0),
    coalesce(sum(x.ordinary_pay) filter (where x.included) over (), 0),
    coalesce(sum(x.ot_pay) filter (where x.included) over (), 0),
    coalesce(sum(x.premium_pay) filter (where x.included) over (), 0),
    coalesce(sum(x.gross) filter (where x.included) over (), 0),
    coalesce(sum(x.hours) filter (where not x.included) over (), 0)
  from run_lines x
  where public.current_user_role() in ('owner', 'system_admin')
  order by
    x.included desc,
    case when p_project_ids is null then null else x.project_name end nulls first,
    x.project_id,
    x.employee_name;
$$;

-- ===========================================================================
-- 8. pay_run_grid - the daily grid: hours per person (per project when
--    filtered) per day, from the snapshot. late = a day from an earlier
--    period.
-- ===========================================================================
create function public.pay_run_grid(p_run_id uuid, p_project_ids uuid[])
returns table (
  project_id  uuid,
  employee_id uuid,
  included    boolean,
  day         date,
  late        boolean,
  hours       numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select null::uuid, d.employee_id, d.included, d.day, d.late, d.total_hours
  from public.pay_run_days d
  where d.run_id = p_run_id
    and p_project_ids is null
    and public.current_user_role() in ('owner', 'system_admin')

  union all

  select a.project_id, a.employee_id, a.included, a.day, d.late, a.hours
  from public.pay_run_allocations a
  join public.pay_run_days d on d.run_id = a.run_id and d.employee_id = a.employee_id and d.day = a.day
  where a.run_id = p_run_id
    and p_project_ids is not null
    and a.project_id = any (p_project_ids)
    and public.current_user_role() in ('owner', 'system_admin')

  order by 2, 1, 4;
$$;

-- ===========================================================================
-- 9. pay_run_projects - the projects in a run's split (the Excel filter's
--    choices). None = the split wasn't saved (closed before 8B-2).
-- ===========================================================================
create function public.pay_run_projects(p_run_id uuid)
returns table (project_id uuid, project_name text)
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct a.project_id, a.project_name
  from public.pay_run_allocations a
  where a.run_id = p_run_id
    and public.current_user_role() in ('owner', 'system_admin')
  order by a.project_name;
$$;

-- ===========================================================================
-- 10. pay_outstanding_people - the "to be paid" list per person (from
--     pay_outstanding): days and hours not in an active run, their pay if
--     priced, unpriced hours (pending people), the oldest day, and how
--     many days fall in no pay period yet. Totals on every row.
-- ===========================================================================
create function public.pay_outstanding_people()
returns table (
  employee_id          uuid,
  employee_name        text,
  employee_status      text,
  days                 bigint,
  hours                numeric,
  unpriced_hours       numeric,
  pay                  numeric,
  first_day            date,
  last_day             date,
  days_in_closed       bigint,
  days_without_period  bigint,
  total_people         bigint,
  total_hours          numeric,
  total_unpriced_hours numeric,
  total_pay            numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    o.employee_id,
    o.employee_name,
    o.employee_status,
    count(*),
    sum(o.total_hours),
    coalesce(sum(o.total_hours) filter (where o.rate is null), 0),
    sum(o.total_pay),
    min(o.day),
    max(o.day),
    count(*) filter (where o.period_status in ('closed', 'paid')),
    count(*) filter (where o.period_id is null),
    count(*) over (),
    sum(sum(o.total_hours)) over (),
    sum(coalesce(sum(o.total_hours) filter (where o.rate is null), 0)) over (),
    coalesce(sum(sum(o.total_pay)) over (), 0)
  from public.pay_outstanding o
  where public.current_user_role() in ('owner', 'system_admin')
  group by o.employee_id, o.employee_name, o.employee_status
  order by min(o.day), o.employee_name;
$$;

-- ===========================================================================
-- 11. export_log accepts the pay-run Excel.
-- ===========================================================================
alter table public.export_log drop constraint export_log_report_type_check;
alter table public.export_log add constraint export_log_report_type_check check (report_type in (
  'project_cost', 'payroll_hours', 'monthly_cost_pack', 'labour_return',
  'delay_register', 'safety_register', 'annual_earnings',
  'my_daily_report', 'my_labour_return', 'pay_run'));

-- ===========================================================================
-- 12. Permissions: logged-in users may call them (the checks inside decide
--     who gets anything); anonymous visitors may not.
-- ===========================================================================
revoke execute on function
  public.pay_period_close_days(uuid),
  public.pay_period_preview(uuid),
  public.pay_run_versions(uuid),
  public.pay_run_people(uuid, uuid[]),
  public.pay_run_grid(uuid, uuid[]),
  public.pay_run_projects(uuid),
  public.pay_outstanding_people()
from public, anon;

grant execute on function
  public.pay_period_close_days(uuid),
  public.pay_period_preview(uuid),
  public.pay_run_versions(uuid),
  public.pay_run_people(uuid, uuid[]),
  public.pay_run_grid(uuid, uuid[]),
  public.pay_run_projects(uuid),
  public.pay_outstanding_people()
to authenticated;

commit;
