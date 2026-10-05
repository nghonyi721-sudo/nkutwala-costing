-- ===========================================================================
-- Phase 8B-1: pay periods and pay runs.
--
-- "Cleared" means paid and locked. Nothing is ever deleted.
--   1. pay_periods: start/end dates (never overlapping), status
--      open -> closed -> paid, reopened only by a system admin with a reason.
--   2. pay_runs + pay_run_lines + pay_run_days: the SNAPSHOT saved when a
--      period is closed (version 1, 2, ...). It never changes; reopening
--      marks it superseded and keeps it.
--   3. close_pay_period / mark_pay_period_paid / reopen_pay_period.
--   4. pay_outstanding: every submitted day not yet in an active pay run -
--      the "to be paid" list.
--   5. LOCKS while a period is closed or paid: reports dated in it (and
--      their crew/equipment lines) can't be created, edited, submitted or
--      reopened; no rate, pay rule or holiday may be added or voided if it
--      would change a day already in an active pay run.
-- Pending people's days are left out of a run (listed as excluded) and stay
-- outstanding; once they're approved, the next run pays them as late hours.
--
-- SECURITY: everything is owner/system_admin only; site managers see
-- nothing. Two kinds of function are SECURITY DEFINER, and why:
--   - close / mark paid / reopen: they write the period's status and the
--     snapshot tables, which the app may not write directly - so these
--     checked functions are the ONLY way to close, pay or reopen. Each
--     checks the role (system_admin for reopen) and the company itself.
--   - the lock triggers: they must see closed periods and paid days even
--     when a SITE MANAGER saves a report (site managers can't read pay
--     periods). A trigger can't be called on its own, and it only ever
--     refuses with "This period is closed. Contact the office." The date
--     check they use is not callable by the app at all.
-- Everything else is SECURITY INVOKER. All-or-nothing.
-- ===========================================================================

begin;

-- For the "periods never overlap" rule (company + date range).
create extension if not exists btree_gist with schema extensions;

-- ===========================================================================
-- 1. pay_periods
-- ===========================================================================
create table public.pay_periods (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null default public.current_user_company_id()
                references public.companies (id),
  start_date    date not null,
  end_date      date not null,
  status        text not null default 'open'
                check (status in ('open', 'closed', 'paid', 'reopened')),
  notes         text not null default '',
  -- Stamped by the database
  created_by    uuid references public.profiles (id),
  created_at    timestamptz not null default now(),
  closed_by     uuid references public.profiles (id),
  closed_at     timestamptz,
  paid_by       uuid references public.profiles (id),
  paid_at       timestamptz,
  paid_on       date,
  reopened_by   uuid references public.profiles (id),
  reopened_at   timestamptz,
  reopen_reason text,
  constraint pay_periods_dates check (end_date >= start_date and end_date - start_date < 366),
  -- Periods can NEVER overlap.
  constraint pay_periods_no_overlap
    exclude using gist (company_id with =, daterange(start_date, end_date, '[]') with &&)
);

-- New periods start open; a closed or paid period's dates can't change.
-- (Status and the stamps can only be changed by the functions below - the
-- app has no permission to write those columns.)
create function public.pay_periods_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.status        := 'open';
    new.created_by    := auth.uid();
    new.created_at    := now();
    new.closed_by     := null;
    new.closed_at     := null;
    new.paid_by       := null;
    new.paid_at       := null;
    new.paid_on       := null;
    new.reopened_by   := null;
    new.reopened_at   := null;
    new.reopen_reason := null;
    return new;
  end if;

  if new.company_id is distinct from old.company_id then
    raise exception 'A pay period cannot move to another company.' using errcode = '42501';
  end if;
  if old.status in ('closed', 'paid')
     and (new.start_date, new.end_date) is distinct from (old.start_date, old.end_date) then
    raise exception 'This period is closed. Its dates cannot change.' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.pay_periods_before_write() from public, anon, authenticated;

create trigger pay_periods_rules
  before insert or update on public.pay_periods
  for each row execute function public.pay_periods_before_write();

create trigger audit_pay_periods
  after insert or update or delete on public.pay_periods
  for each row execute function public.audit_row_change();

revoke all on public.pay_periods from anon, authenticated;
grant select on public.pay_periods to authenticated;
grant insert (start_date, end_date, notes) on public.pay_periods to authenticated;
grant update (start_date, end_date, notes) on public.pay_periods to authenticated;

alter table public.pay_periods enable row level security;

create policy "Owners and system admins read pay periods"
  on public.pay_periods for select to authenticated
  using (
    (select public.current_user_role()) in ('owner', 'system_admin')
    and company_id = (select public.current_user_company_id())
  );

create policy "Owners and system admins add pay periods"
  on public.pay_periods for insert to authenticated
  with check (
    (select public.current_user_role()) in ('owner', 'system_admin')
    and company_id = (select public.current_user_company_id())
  );

create policy "Owners and system admins change open pay periods"
  on public.pay_periods for update to authenticated
  using (
    (select public.current_user_role()) in ('owner', 'system_admin')
    and company_id = (select public.current_user_company_id())
  )
  with check (
    (select public.current_user_role()) in ('owner', 'system_admin')
    and company_id = (select public.current_user_company_id())
  );

-- ===========================================================================
-- 2. The snapshot: pay_runs, pay_run_days, pay_run_lines. Written ONLY by
--    close_pay_period (the app can read, never write).
-- ===========================================================================
create table public.pay_runs (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies (id),
  period_id         uuid not null references public.pay_periods (id),
  version           integer not null check (version >= 1),
  status            text not null default 'active' check (status in ('active', 'superseded')),
  closed_by         uuid references public.profiles (id),
  closed_at         timestamptz not null default now(),
  paid_by           uuid references public.profiles (id),
  paid_at           timestamptz,
  paid_on           date,
  superseded_by     uuid references public.profiles (id),
  superseded_at     timestamptz,
  superseded_reason text,
  constraint pay_runs_one_version unique (period_id, version)
);

-- Only one active run per period.
create unique index pay_runs_one_active_per_period on public.pay_runs (period_id) where status = 'active';

-- Per person per day. included = paid in this run (priced); not included =
-- excluded (no approved rate yet - stays outstanding). late = a day from an
-- earlier closed period that no run had paid yet.
create table public.pay_run_days (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies (id),
  run_id         uuid not null references public.pay_runs (id),
  employee_id    uuid not null references public.employees (id),
  day            date not null,
  included       boolean not null,
  late           boolean not null default false,
  total_hours    numeric not null,
  ordinary_hours numeric,
  ot_hours       numeric,
  premium_hours  numeric,
  rate           numeric,
  rate_from      date,
  ordinary_pay   numeric,
  ot_pay         numeric,
  premium_pay    numeric,
  total_pay      numeric,
  constraint pay_run_days_one_per_day unique (run_id, employee_id, day)
);

create index pay_run_days_employee_day_idx on public.pay_run_days (employee_id, day);

-- Per person: the run's lines. gross = ordinary + overtime + premium pay.
create table public.pay_run_lines (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies (id),
  run_id            uuid not null references public.pay_runs (id),
  employee_id       uuid not null references public.employees (id),
  employee_name     text not null,
  employee_category text not null,
  included          boolean not null,
  days              integer not null,
  hours             numeric not null,
  late_hours        numeric not null default 0,
  ordinary_hours    numeric,
  ot_hours          numeric,
  premium_hours     numeric,
  rates             jsonb not null default '[]'::jsonb,
  ordinary_pay      numeric,
  ot_pay            numeric,
  premium_pay       numeric,
  gross             numeric,
  constraint pay_run_lines_one_per_person unique (run_id, employee_id, included)
);

create trigger audit_pay_runs
  after insert or update or delete on public.pay_runs
  for each row execute function public.audit_row_change();
create trigger audit_pay_run_days
  after insert or update or delete on public.pay_run_days
  for each row execute function public.audit_row_change();
create trigger audit_pay_run_lines
  after insert or update or delete on public.pay_run_lines
  for each row execute function public.audit_row_change();

revoke all on public.pay_runs, public.pay_run_days, public.pay_run_lines from anon, authenticated;
grant select on public.pay_runs, public.pay_run_days, public.pay_run_lines to authenticated;

alter table public.pay_runs enable row level security;
alter table public.pay_run_days enable row level security;
alter table public.pay_run_lines enable row level security;

create policy "Owners and system admins read pay runs"
  on public.pay_runs for select to authenticated
  using (
    (select public.current_user_role()) in ('owner', 'system_admin')
    and company_id = (select public.current_user_company_id())
  );
create policy "Owners and system admins read pay run days"
  on public.pay_run_days for select to authenticated
  using (
    (select public.current_user_role()) in ('owner', 'system_admin')
    and company_id = (select public.current_user_company_id())
  );
create policy "Owners and system admins read pay run lines"
  on public.pay_run_lines for select to authenticated
  using (
    (select public.current_user_role()) in ('owner', 'system_admin')
    and company_id = (select public.current_user_company_id())
  );

-- ===========================================================================
-- 3. The locks
-- ===========================================================================

-- Is this date inside a closed or paid period? Used only inside the lock
-- triggers - not callable by the app.
create function public.pay_date_locked(p_company_id uuid, p_day date)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.pay_periods p
    where p.company_id = p_company_id
      and p.status in ('closed', 'paid')
      and p_day between p.start_date and p.end_date
  );
$$;

revoke execute on function public.pay_date_locked(uuid, date) from public, anon, authenticated;

-- Reports dated in a locked period: no creating, editing, submitting or
-- reopening. (Named to run before the report's other checks, so this is the
-- message people see.)
create function public.daily_reports_period_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.pay_date_locked(new.company_id, new.report_date) then
    raise exception 'This period is closed. Contact the office.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    -- Also when moving a report OUT of a locked period.
    if public.pay_date_locked(old.company_id, old.report_date) then
      raise exception 'This period is closed. Contact the office.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.daily_reports_period_lock() from public, anon, authenticated;

create trigger daily_reports_0_period_lock
  before insert or update on public.daily_reports
  for each row execute function public.daily_reports_period_lock();

-- Crew and equipment lines of a report in a locked period: no changes.
create function public.report_lines_period_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report uuid;
  v_locked boolean;
begin
  if tg_op = 'DELETE' then
    v_report := old.report_id;
  else
    v_report := new.report_id;
  end if;

  select public.pay_date_locked(r.company_id, r.report_date) into v_locked
  from public.daily_reports r
  where r.id = v_report;

  if coalesce(v_locked, false) then
    raise exception 'This period is closed. Contact the office.' using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke execute on function public.report_lines_period_lock() from public, anon, authenticated;

create trigger report_crew_0_period_lock
  before insert or update or delete on public.report_crew
  for each row execute function public.report_lines_period_lock();

create trigger report_equipment_0_period_lock
  before insert or update or delete on public.report_equipment
  for each row execute function public.report_lines_period_lock();

-- Rates: no rate may be added or voided if it would change a day already in
-- an active pay run - i.e. a paid day on or after its start date that no
-- later live rate covers. (People with no paid days - e.g. pending people
-- approved late - are never blocked.)
create function public.employee_rates_period_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee uuid;
  v_from     date;
begin
  if tg_op = 'INSERT' then
    v_employee := new.employee_id;
    v_from := new.effective_from;
  elsif new.void_reason is distinct from old.void_reason then
    v_employee := old.employee_id;
    v_from := old.effective_from;
  else
    return new;
  end if;

  if exists (
    select 1
    from public.pay_run_days d
    join public.pay_runs r on r.id = d.run_id
    where r.status = 'active'
      and d.included
      and d.employee_id = v_employee
      and d.day >= v_from
      and not exists (
        select 1 from public.employee_rates x
        where x.employee_id = v_employee
          and x.voided_at is null
          and x.effective_from > v_from
          and x.effective_from <= d.day
      )
  ) then
    raise exception 'This rate would change days that are already in a closed or paid pay run.' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.employee_rates_period_lock() from public, anon, authenticated;

create trigger employee_rates_0_period_lock
  before insert or update on public.employee_rates
  for each row execute function public.employee_rates_period_lock();

-- Pay rules: the same, company-wide.
create function public.pay_rules_period_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
  v_from    date;
begin
  if tg_op = 'INSERT' then
    v_company := new.company_id;
    v_from := new.effective_from;
  elsif new.void_reason is distinct from old.void_reason then
    v_company := old.company_id;
    v_from := old.effective_from;
  else
    return new;
  end if;

  if exists (
    select 1
    from public.pay_run_days d
    join public.pay_runs r on r.id = d.run_id
    where r.status = 'active'
      and d.included
      and d.company_id = v_company
      and d.day >= v_from
      and not exists (
        select 1 from public.pay_rules x
        where x.company_id = v_company
          and x.voided_at is null
          and x.effective_from > v_from
          and x.effective_from <= d.day
      )
  ) then
    raise exception 'This pay rule would change days that are already in a closed or paid pay run.' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.pay_rules_period_lock() from public, anon, authenticated;

create trigger pay_rules_0_period_lock
  before insert or update on public.pay_rules
  for each row execute function public.pay_rules_period_lock();

-- Public holidays: none added or voided on a paid day.
create function public.public_holidays_period_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
  v_day     date;
begin
  if tg_op = 'INSERT' then
    v_company := new.company_id;
    v_day := new.holiday_date;
  elsif new.void_reason is distinct from old.void_reason then
    v_company := old.company_id;
    v_day := old.holiday_date;
  else
    return new;
  end if;

  if exists (
    select 1
    from public.pay_run_days d
    join public.pay_runs r on r.id = d.run_id
    where r.status = 'active'
      and d.included
      and d.company_id = v_company
      and d.day = v_day
  ) then
    raise exception 'This day is already in a closed or paid pay run.' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.public_holidays_period_lock() from public, anon, authenticated;

create trigger public_holidays_0_period_lock
  before insert or update on public.public_holidays
  for each row execute function public.public_holidays_period_lock();

-- ===========================================================================
-- 4. Owner/admin helpers (SECURITY INVOKER)
-- ===========================================================================

-- The suggested next period: 14 days from the day after the last period
-- ends; today if there is none or the last ended over a month ago.
-- gap_days > 0 = days between the last period and this one (warn, never
-- block); null when there is no earlier period.
create function public.next_pay_period_dates()
returns table (start_date date, end_date date, previous_end date, gap_days integer)
language sql
stable
security invoker
set search_path = ''
as $$
  with last as (
    select max(p.end_date) as end_date
    from public.pay_periods p
    where p.company_id = public.current_user_company_id()
  ),
  today as (
    select (now() at time zone 'Africa/Johannesburg')::date as d
  ),
  pick as (
    select
      case when l.end_date is null or l.end_date < t.d - 31 then t.d else l.end_date + 1 end as start_date,
      l.end_date
    from last l
    cross join today t
  )
  select k.start_date, k.start_date + 13, k.end_date, k.start_date - k.end_date - 1
  from pick k
  where public.current_user_role() in ('owner', 'system_admin');
$$;

-- Days between the period before p_start and p_start (0 = no gap).
create function public.pay_period_gap(p_start date)
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select p_start - max(p.end_date) - 1
  from public.pay_periods p
  where p.company_id = public.current_user_company_id()
    and p.end_date < p_start
    and public.current_user_role() in ('owner', 'system_admin');
$$;

-- What stops a period closing: draft reports dated in it, and hours of
-- approved people with no rate on the day. Pending people don't block (they
-- are left out and paid later).
create function public.pay_period_blockers(p_period_id uuid)
returns table (
  kind         text,
  report_id    uuid,
  report_date  date,
  project_name text,
  person_id    uuid,
  person_name  text,
  hours        numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select 'draft_report', r.id, r.report_date, pr.name, r.reporter_id, rp.full_name, null::numeric
  from public.pay_periods pp
  join public.daily_reports r
    on r.company_id = pp.company_id
   and r.report_date between pp.start_date and pp.end_date
   and r.status = 'draft'
  join public.projects pr on pr.id = r.project_id
  left join public.profiles rp on rp.id = r.reporter_id
  where pp.id = p_period_id
    and public.current_user_role() in ('owner', 'system_admin')

  union all

  select 'unpriced_hours', u.report_id, u.report_date, u.project_name, u.employee_id, u.name, u.hours
  from public.pay_periods pp
  join public.unpriced_hours u
    on u.company_id = pp.company_id
   and u.report_date between pp.start_date and pp.end_date
   and u.category = 'labour'
  join public.employees e on e.id = u.employee_id and e.approved_at is not null
  where pp.id = p_period_id
    and public.current_user_role() in ('owner', 'system_admin')

  order by 1, 3;
$$;

-- The "to be paid" list: every submitted day not in an active pay run.
create view public.pay_outstanding
with (security_invoker = true)
as
select
  d.company_id,
  d.employee_id,
  e.full_name       as employee_name,
  e.status          as employee_status,
  d.day,
  d.total_hours,
  d.rate,
  d.ordinary_hours,
  d.ot_hours,
  d.premium_hours,
  d.total_pay,
  pp.id             as period_id,
  pp.status         as period_status
from public.labour_days d
join public.employees e on e.id = d.employee_id
left join public.pay_periods pp
  on pp.company_id = d.company_id
 and d.day between pp.start_date and pp.end_date
where not exists (
    select 1
    from public.pay_run_days x
    join public.pay_runs r on r.id = x.run_id
    where r.status = 'active'
      and x.included
      and x.employee_id = d.employee_id
      and x.day = d.day
  )
  and (select public.current_user_role()) in ('owner', 'system_admin');

revoke all on public.pay_outstanding from anon, authenticated;
grant select on public.pay_outstanding to authenticated;

-- ===========================================================================
-- 5. Close, mark paid, reopen (SECURITY DEFINER - see the top of the file)
-- ===========================================================================
create function public.close_pay_period(p_period_id uuid)
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

  -- The days: every day in the period (priced = paid, unpriced = excluded,
  -- i.e. pending people), plus LATE days: priced days in earlier closed
  -- periods. Never a day another active run has already paid (e.g. a late
  -- day paid by a later run, when this period is closed again).
  insert into public.pay_run_days (
    company_id, run_id, employee_id, day, included, late, total_hours, ordinary_hours, ot_hours,
    premium_hours, rate, rate_from, ordinary_pay, ot_pay, premium_pay, total_pay
  )
  select
    v_company, v_run, d.employee_id, d.day,
    d.rate is not null,
    d.day < v_period.start_date,
    d.total_hours, d.ordinary_hours, d.ot_hours, d.premium_hours, d.rate,
    (select r.effective_from from public.employee_rates r
      where r.employee_id = d.employee_id and r.effective_from <= d.day and r.voided_at is null
      order by r.effective_from desc limit 1),
    d.ordinary_pay, d.ot_pay, d.premium_pay, d.total_pay
  from public.labour_days d
  where d.company_id = v_company
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
      d.day between v_period.start_date and v_period.end_date
      or (
        d.day < v_period.start_date
        and d.rate is not null
        and exists (
          select 1 from public.pay_periods q
          where q.company_id = v_company
            and q.status in ('closed', 'paid')
            and d.day between q.start_date and q.end_date
        )
      )
    );

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

  update public.pay_periods
  set status = 'closed', closed_by = auth.uid(), closed_at = now()
  where id = p_period_id;

  return v_run;
end;
$$;

create function public.mark_pay_period_paid(p_period_id uuid, p_paid_on date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid := public.current_user_company_id();
begin
  if coalesce(public.current_user_role() in ('owner', 'system_admin'), false) is false then
    raise exception 'Only the owner can mark a pay period paid.' using errcode = '42501';
  end if;
  if p_paid_on is null then
    raise exception 'Choose the date it was paid.' using errcode = '23514';
  end if;

  update public.pay_periods
  set status = 'paid', paid_by = auth.uid(), paid_at = now(), paid_on = p_paid_on
  where id = p_period_id and company_id = v_company and status = 'closed';
  if not found then
    raise exception 'Only a closed pay period can be marked paid.' using errcode = '23514';
  end if;

  update public.pay_runs
  set paid_by = auth.uid(), paid_at = now(), paid_on = p_paid_on
  where period_id = p_period_id and status = 'active';
end;
$$;

create function public.reopen_pay_period(p_period_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid := public.current_user_company_id();
begin
  if coalesce(public.current_user_role() = 'system_admin', false) is false then
    raise exception 'Only a system admin can reopen a pay period.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'A reason is required to reopen a pay period.' using errcode = '23514';
  end if;

  update public.pay_periods
  set status = 'reopened',
      reopened_by = auth.uid(), reopened_at = now(), reopen_reason = trim(p_reason),
      closed_by = null, closed_at = null, paid_by = null, paid_at = null, paid_on = null
  where id = p_period_id and company_id = v_company and status in ('closed', 'paid');
  if not found then
    raise exception 'Only a closed or paid pay period can be reopened.' using errcode = '23514';
  end if;

  -- The snapshot is kept, marked superseded - never overwritten.
  update public.pay_runs
  set status = 'superseded', superseded_by = auth.uid(), superseded_at = now(), superseded_reason = trim(p_reason)
  where period_id = p_period_id and status = 'active';
end;
$$;

-- ===========================================================================
-- 6. Permissions: logged-in users may call these (the checks inside decide);
--    anonymous visitors may not.
-- ===========================================================================
revoke execute on function
  public.next_pay_period_dates(),
  public.pay_period_gap(date),
  public.pay_period_blockers(uuid),
  public.close_pay_period(uuid),
  public.mark_pay_period_paid(uuid, date),
  public.reopen_pay_period(uuid, text)
from public, anon;

grant execute on function
  public.next_pay_period_dates(),
  public.pay_period_gap(date),
  public.pay_period_blockers(uuid),
  public.close_pay_period(uuid),
  public.mark_pay_period_paid(uuid, date),
  public.reopen_pay_period(uuid, text)
to authenticated;

commit;
