-- ===========================================================================
-- Payroll and expenses exports (docs/payroll-export-format.md).
--
-- Pay is now simple: the owner picks a project, a start date and an end
-- date and downloads two Excel files - the payroll and the expenses
-- statement. The file is the record: no pay periods, no closing, no pay
-- rule settings, no holiday calendar.
--
--   1. REMOVED FOR GOOD (the owner's decision): pay rules, public holidays,
--      pay periods and pay runs - their 7 tables WITH THEIR ROWS, their
--      views, functions, triggers and the "period is closed" locks. Also
--      the old Payroll hours sheet's two functions. The audit log keeps its
--      history of them (it is never deleted).
--   2. The pay rule is now fixed: up to 8 h a day (all sites together) is
--      normal, the rest overtime at x1.5 - exactly the only rule that was
--      in force, so labour cost does not change. labour_days and
--      labour_lines (and the cost views built on them) are rebuilt without
--      the pay_rules / public_holidays tables. Their Sunday / holiday
--      ("premium") columns stay, always 0, so the dashboard, drill-down and
--      export functions that read them keep working unchanged.
--   3. Daily reports: all_overtime - "Sunday or public holiday": every hour
--      on that report is overtime. Set by the site manager on a draft.
--   4. Employees: surname (optional; the full name ends with it),
--      first_names (worked out by the database) and uif_registered (owners
--      and admins only).
--   5. overtime_warnings: the limits are fixed at the values that were in
--      force (over 12 h in a day, over 10 overtime hours in a week).
--   6. The exports: payroll_lines, payroll_blocks, payroll_checks,
--      expense_lines, expense_totals (and round_half_even, banker's
--      rounding). Owner/system_admin ONLY - anyone else gets an error and
--      no figures (the Rate Wall).
--   7. export_log accepts 'payroll' and 'expenses_statement'.
--
-- All-or-nothing. When it finishes, the SQL Editor lists what was removed.
-- ===========================================================================

begin;

-- What this migration removed, shown at the end.
create temp table payroll_exports_log (step text, item text, detail text);

insert into payroll_exports_log (step, item, detail)
select '1. Deleted (with all rows)', 'pay_rules', count(*) || ' pay rule(s)' from public.pay_rules
union all
select '1. Deleted (with all rows)', 'public_holidays', count(*) || ' public holiday(s)' from public.public_holidays
union all
select '1. Deleted (with all rows)', 'pay_periods', count(*) || ' pay period(s)' from public.pay_periods
union all
select '1. Deleted (with all rows)', 'pay_runs', count(*) || ' pay run(s)' from public.pay_runs
union all
select '1. Deleted (with all rows)', 'pay_run_days', count(*) || ' pay run day(s)' from public.pay_run_days
union all
select '1. Deleted (with all rows)', 'pay_run_lines', count(*) || ' pay run line(s)' from public.pay_run_lines
union all
select '1. Deleted (with all rows)', 'pay_run_allocations', count(*) || ' pay run project split(s)' from public.pay_run_allocations;

-- ===========================================================================
-- 1. Remove pay periods, pay runs, pay rules and public holidays.
-- ===========================================================================

-- The views built on them go first. The labour and cost views read the
-- pay rules: they are rebuilt in section 4, exactly as before but with the
-- rule written in.
drop view public.pay_period_overview;
drop view public.pay_outstanding;
drop view public.project_cost_vs_budget;
drop view public.project_cost_by_week;
drop view public.project_cost_lines;
drop view public.labour_lines;
drop view public.labour_provisional_by_employee_week;
drop view public.labour_days;

-- The "this period is closed" locks on the tables that stay.
drop trigger daily_reports_0_period_lock on public.daily_reports;
drop trigger report_crew_0_period_lock on public.report_crew;
drop trigger report_equipment_0_period_lock on public.report_equipment;
drop trigger employee_rates_0_period_lock on public.employee_rates;

-- The tables, with their rows (their own triggers go with them).
drop table public.pay_run_allocations;
drop table public.pay_run_lines;
drop table public.pay_run_days;
drop table public.pay_runs;
drop table public.pay_periods;
drop table public.pay_rules;
drop table public.public_holidays;

-- Their functions.
drop function public.pay_rules_before_write();
drop function public.pay_rules_keep_first();
drop function public.public_holidays_before_write();
drop function public.pay_periods_before_write();
drop function public.pay_date_locked(uuid, date);
drop function public.daily_reports_period_lock();
drop function public.report_lines_period_lock();
drop function public.employee_rates_period_lock();
drop function public.pay_rules_period_lock();
drop function public.public_holidays_period_lock();
drop function public.next_pay_period_dates();
drop function public.pay_period_gap(date);
drop function public.pay_period_blockers(uuid);
drop function public.pay_period_close_days(uuid);
drop function public.pay_period_preview(uuid);
drop function public.close_pay_period(uuid);
drop function public.mark_pay_period_paid(uuid, date);
drop function public.reopen_pay_period(uuid, text);
drop function public.pay_run_versions(uuid);
drop function public.pay_run_people(uuid, uuid[]);
drop function public.pay_run_grid(uuid, uuid[]);
drop function public.pay_run_projects(uuid);
drop function public.pay_outstanding_people();

-- The old Payroll hours sheet (replaced by the payroll export below).
drop function public.export_payroll(uuid[], date, date);
drop function public.export_daily_hours(uuid[], date, date);

insert into payroll_exports_log (step, item, detail) values
  ('2. Deleted', 'views', 'pay_period_overview, pay_outstanding'),
  ('2. Deleted', 'period locks', 'on daily_reports, report_crew, report_equipment, employee_rates'),
  ('2. Deleted', 'functions', '23 pay rule / holiday / pay period / pay run functions'),
  ('2. Deleted', 'old payroll hours sheet', 'export_payroll, export_daily_hours');

-- ===========================================================================
-- 2. Daily reports: "Sunday or public holiday - every hour is overtime".
-- ===========================================================================
alter table public.daily_reports
  add column all_overtime boolean not null default false;

grant insert (all_overtime) on public.daily_reports to authenticated;
grant update (all_overtime) on public.daily_reports to authenticated;

-- The guard (as in 20261004090000), with all_overtime among the contents an
-- owner reopening a report may not change.
create or replace function public.daily_reports_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- These never change after creation.
  if new.company_id  is distinct from old.company_id
  or new.reporter_id is distinct from old.reporter_id
  or new.created_at  is distinct from old.created_at then
    raise exception 'The company, reporter and creation time of a report cannot be changed.';
  end if;

  if old.status = 'draft' then
    -- Editing or submitting a draft. Only the reporter gets here (RLS).
    if new.submitted_at  is distinct from old.submitted_at
    or new.reopened_at   is distinct from old.reopened_at
    or new.reopened_by   is distinct from old.reopened_by
    or new.reopen_reason is distinct from old.reopen_reason then
      raise exception 'Submission and reopen details are set by the system.';
    end if;

    if new.status = 'submitted' then
      new.submitted_at := now();
    end if;

  else
    -- The report is submitted: the ONLY allowed change is an owner/admin
    -- reopening it with a reason.
    if public.current_user_role() not in ('owner', 'system_admin') then
      raise exception 'This report has been submitted and can no longer be changed.';
    end if;

    if new.status <> 'draft' then
      raise exception 'A submitted report can only be reopened.';
    end if;

    if (new.project_id, new.report_date, new.start_time, new.end_time,
        new.rain_percent, new.delay_hours, new.fuel_litres,
        new.dsti_done, new.internal_audit, new.near_miss, new.safety_moment,
        new.activities, new.all_overtime, new.submitted_at)
       is distinct from
       (old.project_id, old.report_date, old.start_time, old.end_time,
        old.rain_percent, old.delay_hours, old.fuel_litres,
        old.dsti_done, old.internal_audit, old.near_miss, old.safety_moment,
        old.activities, old.all_overtime, old.submitted_at) then
      raise exception 'Owners can reopen a report but not change its contents.';
    end if;

    if length(trim(coalesce(new.reopen_reason, ''))) = 0 then
      raise exception 'A reason is required to reopen a report.';
    end if;

    new.reopened_at := now();
    new.reopened_by := auth.uid();
  end if;

  new.updated_at := now();
  return new;
end;
$$;

-- save_report_draft (as in 20261007090000), now also saving all_overtime.
create or replace function public.save_report_draft(p_report jsonb, p_crew jsonb, p_equipment jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid := nullif(p_report ->> 'id', '')::uuid;
begin
  if v_id is null then
    insert into public.daily_reports (
      project_id, report_date, start_time, end_time, rain_percent, delay_hours,
      fuel_litres, dsti_done, internal_audit, near_miss, safety_moment, activities,
      all_overtime
    )
    values (
      (p_report ->> 'project_id')::uuid,
      (p_report ->> 'report_date')::date,
      nullif(p_report ->> 'start_time', '')::time,
      nullif(p_report ->> 'end_time', '')::time,
      coalesce((p_report ->> 'rain_percent')::smallint, 0),
      coalesce((p_report ->> 'delay_hours')::numeric, 0),
      coalesce((p_report ->> 'fuel_litres')::numeric, 0),
      coalesce((p_report ->> 'dsti_done')::boolean, false),
      coalesce((p_report ->> 'internal_audit')::boolean, false),
      coalesce((p_report ->> 'near_miss')::boolean, false),
      coalesce((p_report ->> 'safety_moment')::boolean, false),
      coalesce(p_report ->> 'activities', ''),
      coalesce((p_report ->> 'all_overtime')::boolean, false)
    )
    returning id into v_id;
  else
    update public.daily_reports set
      project_id     = (p_report ->> 'project_id')::uuid,
      report_date    = (p_report ->> 'report_date')::date,
      start_time     = nullif(p_report ->> 'start_time', '')::time,
      end_time       = nullif(p_report ->> 'end_time', '')::time,
      rain_percent   = coalesce((p_report ->> 'rain_percent')::smallint, 0),
      delay_hours    = coalesce((p_report ->> 'delay_hours')::numeric, 0),
      fuel_litres    = coalesce((p_report ->> 'fuel_litres')::numeric, 0),
      dsti_done      = coalesce((p_report ->> 'dsti_done')::boolean, false),
      internal_audit = coalesce((p_report ->> 'internal_audit')::boolean, false),
      near_miss      = coalesce((p_report ->> 'near_miss')::boolean, false),
      safety_moment  = coalesce((p_report ->> 'safety_moment')::boolean, false),
      activities     = coalesce(p_report ->> 'activities', ''),
      all_overtime   = coalesce((p_report ->> 'all_overtime')::boolean, false)
    where id = v_id;

    if not found then
      raise exception 'This report can no longer be edited. It may have been submitted.'
        using errcode = '42501';
    end if;
  end if;

  -- Crew: remove people no longer on the list, then add/update the rest.
  delete from public.report_crew c
  where c.report_id = v_id
    and not exists (
      select 1 from jsonb_array_elements(coalesce(p_crew, '[]'::jsonb)) x
      where (x ->> 'employee_id')::uuid = c.employee_id
    );

  insert into public.report_crew (report_id, employee_id, hours)
  select v_id, (x ->> 'employee_id')::uuid, (x ->> 'hours')::numeric
  from jsonb_array_elements(coalesce(p_crew, '[]'::jsonb)) x
  on conflict (report_id, employee_id) do update
    set hours = excluded.hours
    where public.report_crew.hours is distinct from excluded.hours;

  -- Equipment: the same.
  delete from public.report_equipment q
  where q.report_id = v_id
    and not exists (
      select 1 from jsonb_array_elements(coalesce(p_equipment, '[]'::jsonb)) x
      where (x ->> 'equipment_id')::uuid = q.equipment_id
    );

  insert into public.report_equipment (report_id, equipment_id, hours)
  select v_id, (x ->> 'equipment_id')::uuid, (x ->> 'hours')::numeric
  from jsonb_array_elements(coalesce(p_equipment, '[]'::jsonb)) x
  on conflict (report_id, equipment_id) do update
    set hours = excluded.hours
    where public.report_equipment.hours is distinct from excluded.hours;

  return v_id;
end;
$$;

-- ===========================================================================
-- 3. Employees: surname, first_names and UIF registration.
--    surname: optional. When given, the full name ends with it (the app
--             builds the full name from "First name(s)" + "Surname").
--    first_names: the full name without the surname - worked out here.
--    uif_registered: only owners and admins change it (the guard below).
-- ===========================================================================
alter table public.employees
  add column surname text,
  add column uif_registered boolean not null default false,
  add constraint employees_surname_check check (
    surname is null
    or (
      surname = trim(surname)
      and length(surname) between 1 and 60
      and length(full_name) > length(surname) + 1
      and right(full_name, length(surname) + 1) = ' ' || surname
      and length(trim(left(full_name, length(full_name) - length(surname) - 1))) > 0
    )
  );

alter table public.employees
  add column first_names text generated always as (
    case
      when surname is null then full_name
      else rtrim(left(full_name, length(full_name) - length(surname) - 1))
    end
  ) stored;

grant insert (surname, uif_registered) on public.employees to authenticated;
grant update (surname, uif_registered) on public.employees to authenticated;

-- The guard (as in 20261007120000), plus: only owners and admins set
-- uif_registered.
create or replace function public.employees_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_is_admin boolean := coalesce(public.current_user_role() in ('owner', 'system_admin'), false);
begin
  if tg_op = 'INSERT' then
    if new.uif_registered and not v_is_admin then
      raise exception 'Only the owner can mark someone as UIF registered.' using errcode = '42501';
    end if;
    -- Who added them comes from the login, never from the app.
    new.created_by    := auth.uid();
    new.status        := 'pending';
    new.approved_at   := null;
    new.approved_by   := null;
    new.rejected_at   := null;
    new.rejected_by   := null;
    new.reject_reason := null;
    return new;
  end if;

  if new.created_by  is distinct from old.created_by
  or new.company_id  is distinct from old.company_id
  or new.approved_at is distinct from old.approved_at
  or new.approved_by is distinct from old.approved_by
  or new.rejected_at is distinct from old.rejected_at
  or new.rejected_by is distinct from old.rejected_by then
    raise exception 'These details are set by the system and cannot be changed.' using errcode = '42501';
  end if;

  if new.uif_registered is distinct from old.uif_registered and not v_is_admin then
    raise exception 'Only the owner can mark someone as UIF registered.' using errcode = '42501';
  end if;

  if new.reject_reason is distinct from old.reject_reason
     and not (old.status = 'pending' and new.status = 'inactive') then
    raise exception 'A reason can only be given when rejecting a new employee.' using errcode = '23514';
  end if;

  if new.status is distinct from old.status then
    if not v_is_admin then
      raise exception 'Only the owner can approve, reject or deactivate employees.' using errcode = '42501';
    end if;

    if new.status = 'pending' then
      raise exception 'An employee cannot go back to pending.' using errcode = '23514';
    end if;

    if new.status = 'approved' and old.approved_at is null then
      -- First approval: never without a live hourly rate.
      if not exists (
        select 1 from public.employee_rates r
        where r.employee_id = new.id
          and r.voided_at is null
      ) then
        raise exception 'Add an hourly rate before approving this employee.' using errcode = '23514';
      end if;
      new.approved_at   := now();
      new.approved_by   := auth.uid();
      new.rejected_at   := null;
      new.rejected_by   := null;
      new.reject_reason := null;
    end if;

    if old.status = 'pending' and new.status = 'inactive' then
      -- Rejecting a new employee needs a reason.
      if length(trim(coalesce(new.reject_reason, ''))) = 0 then
        raise exception 'A reason is required to reject a new employee.' using errcode = '23514';
      end if;
      new.rejected_at := now();
      new.rejected_by := auth.uid();
    end if;
  end if;

  return new;
end;
$$;

-- ===========================================================================
-- 4. labour_days / labour_lines with the pay rule written in, and the views
--    built on them (exactly as in 20261009090000 / 20261012100000 apart from
--    the rule and the Sunday / public holiday switch).
--
--    labour_days - per person per date: all SUBMITTED hours that day across
--    all reports and projects (Absent 0 h lines don't count), at the rate
--    on that day (null = unpriced).
--      Hours on an all_overtime report (Sunday / public holiday): overtime.
--      Other hours: up to 8 h normal ("ordinary"), the rest overtime.
--      Overtime is paid at x1.5. Premium (Sunday / holiday) columns: 0.
--    New last column: overtime_day_hours (the all_overtime report hours).
-- ===========================================================================
create view public.labour_days
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
    public.rate_on(d.employee_id, d.day)                                         as rate,
    least(d.total_hours - d.overtime_day_hours, 8)                               as ordinary_hours,
    greatest(d.total_hours - d.overtime_day_hours - 8, 0) + d.overtime_day_hours as ot_hours
  from days d
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

-- labour_lines - each submitted report line's share of its day.
--   A line on an all_overtime report: all its hours are overtime. The other
--   lines share the day's normal hours and its remaining overtime by their
--   hours; pay follows the hours. Shares are rounded to cents; the biggest
--   ordinary line that day takes the leftover so lines add up exactly.
--   (A day with no all_overtime report: exactly as before.)
--   day_pay and lines are MATERIALIZED - see 20261012100000 (speed).
create view public.labour_lines
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
    r.id           as report_id,
    r.report_date  as day,
    c.id           as line_id,
    c.employee_id,
    c.hours,
    r.all_overtime,
    row_number() over (
      partition by c.employee_id, r.report_date
      order by r.all_overtime, c.hours desc, r.project_id, c.id
    ) as rn
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
    case when l.all_overtime then 0
         else round(d.ordinary_hours * l.hours / (d.total_hours - d.overtime_day_hours), 2) end as part_ordinary_hours,
    case when l.all_overtime then l.hours
         else round((d.ot_hours - d.overtime_day_hours) * l.hours / (d.total_hours - d.overtime_day_hours), 2) end as part_ot_hours,
    round(d.premium_hours * l.hours / d.total_hours, 2)  as part_premium_hours,
    case when l.all_overtime then round(0 * d.rate, 2)
         else round(d.ordinary_pay * l.hours / (d.total_hours - d.overtime_day_hours), 2) end as part_ordinary_pay,
    case when d.overtime_day_hours = 0 then round(d.ot_pay * l.hours / d.total_hours, 2)
         when l.all_overtime then round(d.ot_pay * l.hours / d.ot_hours, 2)
         else round(d.ot_pay * ((d.ot_hours - d.overtime_day_hours) * l.hours
                                / (d.total_hours - d.overtime_day_hours)) / d.ot_hours, 2) end as part_ot_pay,
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

-- project_cost_lines and its two views - exactly as in 20261009090000.
create view public.project_cost_lines
with (security_invoker = true)
as
-- Labour: crew hours on SUBMITTED reports, paid by the day (normal hours +
-- overtime above 8 h a day at x1.5) at the rate on that day.
select
  l.company_id,
  l.project_id,
  'labour'::text      as category,
  l.day               as cost_date,
  l.report_id,
  l.employee_id,
  null::uuid          as equipment_id,
  null::uuid          as receipt_id,
  null::text          as vendor,
  l.hours,
  l.rate              as unit_rate,
  l.amount,
  l.ordinary_hours,
  l.ot_hours,
  l.premium_hours,
  l.ot_pay            as ot_amount,
  l.premium_pay       as premium_amount
from public.labour_lines l
where l.rate is not null
  and (select public.current_user_role()) in ('owner', 'system_admin')

union all

-- Owned plant: OWNED equipment hours on SUBMITTED reports x the rate on
-- that day. Rented equipment is never priced here (its hire receipts are).
select
  r.company_id,
  r.project_id,
  'owned_plant'::text,
  r.report_date,
  r.id,
  null::uuid,
  e.equipment_id,
  null::uuid,
  null::text,
  e.hours,
  rate.hourly_rate,
  round(e.hours * rate.hourly_rate, 2),
  null::numeric,
  null::numeric,
  null::numeric,
  null::numeric,
  null::numeric
from public.daily_reports r
join public.report_equipment e on e.report_id = r.id
join public.equipment q on q.id = e.equipment_id
cross join lateral (select public.equipment_rate_on(e.equipment_id, r.report_date) as hourly_rate) rate
where r.status = 'submitted'
  and q.ownership = 'own'
  and rate.hourly_rate is not null
  and (select public.current_user_role()) in ('owner', 'system_admin')

union all

-- Receipts: APPROVED only. Amount = total paid, VAT inclusive. The amount
-- comes through receipt_amounts (owners/admins only).
select
  rc.company_id,
  rc.project_id,
  rc.category,
  rc.receipt_date,
  null::uuid,
  null::uuid,
  null::uuid,
  rc.id,
  rc.vendor,
  null::numeric,
  null::numeric,
  a.amount,
  null::numeric,
  null::numeric,
  null::numeric,
  null::numeric,
  null::numeric
from public.receipts rc
join public.receipt_amounts a on a.receipt_id = rc.id
where rc.status = 'approved'
  and (select public.current_user_role()) in ('owner', 'system_admin');

create view public.project_cost_vs_budget
with (security_invoker = true)
as
select
  p.company_id,
  p.id                              as project_id,
  p.name                            as project_name,
  cc.code                           as category,
  cc.label                          as category_label,
  cc.sort_order,
  b.amount                          as budget,
  coalesce(spent.amount, 0)         as spent,
  b.amount - coalesce(spent.amount, 0) as remaining,
  case when b.amount > 0
       then round(100 * coalesce(spent.amount, 0) / b.amount, 1) end as percent_used,
  coalesce(unpriced.hours, 0)       as unpriced_hours
from public.projects p
cross join public.cost_categories cc
left join public.project_budgets b
  on b.project_id = p.id and b.category = cc.code
left join (
  select l.project_id, l.category, sum(l.amount) as amount
  from public.project_cost_lines l
  group by l.project_id, l.category
) spent on spent.project_id = p.id and spent.category = cc.code
left join (
  select u.project_id, u.category, sum(u.hours) as hours
  from public.unpriced_hours u
  group by u.project_id, u.category
) unpriced on unpriced.project_id = p.id and unpriced.category = cc.code
where (select public.current_user_role()) in ('owner', 'system_admin');

create view public.project_cost_by_week
with (security_invoker = true)
as
select
  l.company_id,
  l.project_id,
  date_trunc('week', l.cost_date)::date as week_start,
  l.category,
  sum(l.amount)                         as amount
from public.project_cost_lines l
where (select public.current_user_role()) in ('owner', 'system_admin')
group by l.company_id, l.project_id, date_trunc('week', l.cost_date)::date, l.category;

-- labour_provisional_by_employee_week - as in 20261009090000 (basis text
-- updated: there are no pay rule settings any more).
create view public.labour_provisional_by_employee_week
with (security_invoker = true)
as
select
  d.company_id,
  d.employee_id,
  emp.full_name                                                 as employee_name,
  date_trunc('week', d.day)::date                               as week_start,
  sum(d.total_hours)                                            as hours,
  sum(d.total_hours) filter (where d.rate is not null)          as priced_hours,
  coalesce(sum(d.total_pay), 0)                                 as cost,
  coalesce(sum(d.total_hours) filter (where d.rate is null), 0) as unpriced_hours,
  'PROVISIONAL: hours x rate, overtime above 8 h a day at x1.5, before deductions'::text as basis,
  coalesce(sum(d.ot_hours) filter (where d.rate is not null), 0) as ot_hours,
  coalesce(sum(d.ot_pay), 0)                                    as ot_pay
from public.labour_days d
join public.employees emp on emp.id = d.employee_id
where (select public.current_user_role()) in ('owner', 'system_admin')
group by d.company_id, d.employee_id, emp.full_name, date_trunc('week', d.day)::date;

revoke all on public.labour_days, public.labour_lines, public.project_cost_lines,
  public.project_cost_vs_budget, public.project_cost_by_week, public.labour_provisional_by_employee_week
  from anon, authenticated;
grant select on public.labour_days, public.labour_lines, public.project_cost_lines,
  public.project_cost_vs_budget, public.project_cost_by_week, public.labour_provisional_by_employee_week
  to authenticated;

-- ===========================================================================
-- 5. overtime_warnings (as in 20261013090000) with the limits that were in
--    force fixed: a day over 12 h (all projects), a Mon-Sun week over 10
--    overtime hours. Warnings only, never blocking.
-- ===========================================================================
create or replace function public.overtime_warnings(p_project_id uuid, p_from date, p_to date, p_employee_id uuid default null)
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
    select d.employee_id, d.day, d.total_hours, d.ot_hours
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
    select d.employee_id, 'day'::text as kind, d.day, d.total_hours as hours, 12::numeric as limit_hours
    from day_pay d
    where d.day between p_from and p_to
      and d.total_hours > 12
      and exists (select 1 from on_project o where o.employee_id = d.employee_id and o.report_date = d.day)
  ),
  weeks as (
    select
      d.employee_id,
      date_trunc('week', d.day::timestamp)::date as week_start,
      sum(d.ot_hours)                            as hours,
      10::numeric                                as limit_hours
    from day_pay d
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

-- ===========================================================================
-- 6. The exports. Owner/system_admin only: anyone else gets an error.
-- ===========================================================================

-- Banker's rounding to cents (round half to even), as the payroll
-- spreadsheet does: 215.625 -> 215.62, 309.375 -> 309.38.
create function public.round_half_even(p_value numeric)
returns numeric
language sql
immutable
strict
set search_path = ''
as $$
  select case
    when abs(p_value * 100 - trunc(p_value * 100)) = 0.5 then
      round((trunc(p_value * 100)
             + case when mod(trunc(p_value * 100), 2) = 0 then 0 else sign(p_value) end) / 100, 2)
    else round(p_value, 2)
  end;
$$;

-- The checks every export function starts with: the caller is an owner or
-- admin, and the project and dates make sense.
create function public.payroll_check_inputs(p_project_id uuid, p_from date, p_to date)
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if coalesce(public.current_user_role() not in ('owner', 'system_admin'), true) then
    raise exception 'Only the owner can see payroll and expenses.' using errcode = '42501';
  end if;
  if p_project_id is null or p_from is null or p_to is null then
    raise exception 'Choose a project, a start date and an end date.' using errcode = '22023';
  end if;
  if p_to < p_from then
    raise exception 'The end date is before the start date.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.projects p where p.id = p_project_id) then
    raise exception 'That project was not found.' using errcode = 'P0002';
  end if;
end;
$$;

-- payroll_checks - what the Payroll screen shows before a download:
--   submitted_reports / draft_reports: this project's reports in the range
--   receipts_waiting: receipts in the range not yet approved or rejected
--   unpriced: people with hours here but no approved rate on those days -
--             [{ employee_id, full_name, hours }]. The payroll can't be
--             made until they are approved with a rate (never a silent R0).
create function public.payroll_checks(p_project_id uuid, p_from date, p_to date)
returns table (
  submitted_reports bigint,
  draft_reports     bigint,
  receipts_waiting  bigint,
  unpriced          jsonb
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform public.payroll_check_inputs(p_project_id, p_from, p_to);

  return query
  select
    (select count(*) from public.daily_reports r
     where r.project_id = p_project_id and r.report_date between p_from and p_to and r.status = 'submitted'),
    (select count(*) from public.daily_reports r
     where r.project_id = p_project_id and r.report_date between p_from and p_to and r.status = 'draft'),
    (select count(*) from public.receipts rc
     where rc.project_id = p_project_id and rc.receipt_date between p_from and p_to and rc.status = 'submitted'),
    coalesce((
      select jsonb_agg(jsonb_build_object('employee_id', u.employee_id, 'full_name', u.full_name, 'hours', u.hours)
                       order by u.full_name)
      from (
        select l.employee_id, e.full_name, sum(l.hours) as hours
        from public.labour_lines l
        join public.employees e on e.id = l.employee_id
        where l.project_id = p_project_id
          and l.day between p_from and p_to
          and l.rate is null
        group by l.employee_id, e.full_name
      ) u
    ), '[]'::jsonb);
end;
$$;

-- payroll_lines - the payroll's rows: per 14-day block (block 0 starts on
-- the start date), per person, per rate (a rate change gives two rows).
--   Hours: this project's share of each day (labour_lines: 8 h a day across
--   all sites is normal, the rest overtime; an all_overtime report is all
--   overtime), summed over the block.
--   GROSS = normal hours x rate; OVERTIME = overtime hours x rate x 1.5;
--   TOTAL = GROSS + OVERTIME; UIF = TOTAL x 0.01 if UIF registered, else
--   null (left blank); NET = TOTAL - UIF. Every money value is rounded to
--   cents half-to-even BEFORE anything is added up.
--   Highest rate first, then by name (as in the payroll spreadsheet).
create function public.payroll_lines(p_project_id uuid, p_from date, p_to date)
returns table (
  block_no     integer,
  employee_id  uuid,
  first_names  text,
  surname      text,
  rate         numeric,
  normal_hours numeric,
  ot_hours     numeric,
  total_hours  numeric,
  gross        numeric,
  overtime     numeric,
  total_salary numeric,
  uif          numeric,
  net          numeric
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_unpriced text;
begin
  perform public.payroll_check_inputs(p_project_id, p_from, p_to);

  select string_agg(distinct e.full_name, ', ')
  into v_unpriced
  from public.labour_lines l
  join public.employees e on e.id = l.employee_id
  where l.project_id = p_project_id
    and l.day between p_from and p_to
    and l.rate is null;

  if v_unpriced is not null then
    raise exception 'These people have hours in this period but no approved rate: %. Approve them with a rate first.', v_unpriced
      using errcode = '23514';
  end if;

  return query
  with hours as (
    select
      ((l.day - p_from) / 14)::integer as block_no,
      l.employee_id,
      l.rate,
      sum(l.ordinary_hours)            as normal_hours,
      sum(l.ot_hours)                  as ot_hours
    from public.labour_lines l
    where l.project_id = p_project_id
      and l.day between p_from and p_to
    group by ((l.day - p_from) / 14)::integer, l.employee_id, l.rate
  ),
  pay as (
    select
      h.block_no,
      h.employee_id,
      h.rate,
      h.normal_hours,
      h.ot_hours,
      public.round_half_even(h.normal_hours * h.rate)       as gross,
      public.round_half_even(h.ot_hours * h.rate * 1.5)     as overtime
    from hours h
  ),
  priced as (
    select
      p.*,
      case when e.uif_registered then public.round_half_even((p.gross + p.overtime) * 0.01) end as uif,
      e.first_names,
      e.surname
    from pay p
    join public.employees e on e.id = p.employee_id
  )
  select
    u.block_no,
    u.employee_id,
    u.first_names,
    u.surname,
    u.rate,
    u.normal_hours,
    u.ot_hours,
    u.normal_hours + u.ot_hours,
    u.gross,
    u.overtime,
    u.gross + u.overtime,
    u.uif,
    u.gross + u.overtime - coalesce(u.uif, 0)
  from priced u
  order by u.block_no, u.rate desc, u.first_names, u.surname nulls first, u.employee_id;
end;
$$;

-- payroll_blocks - every 14-day block in the range (block 0 starts on the
-- start date, the last one ends on the end date), each on the sheet of the
-- month it ENDS in, with:
--   block_in_sheet / blocks_in_sheet: 1st, 2nd... of how many on its sheet
--   reports: this project's submitted reports in the block
--   the block's totals (the TOTALS row: columns F to M)
--   its sheet's month summary: total salary, net pay and the SARS UIF
--   declaration (employee UIF x 2 - the employer matches 1:1).
create function public.payroll_blocks(p_project_id uuid, p_from date, p_to date)
returns table (
  block_no              integer,
  block_start           date,
  block_end             date,
  sheet_month           date,
  block_in_sheet        integer,
  blocks_in_sheet       integer,
  reports               bigint,
  people                bigint,
  normal_hours          numeric,
  ot_hours              numeric,
  total_hours           numeric,
  gross                 numeric,
  overtime              numeric,
  total_salary          numeric,
  uif                   numeric,
  net                   numeric,
  month_total_salary    numeric,
  month_net             numeric,
  month_uif_declaration numeric
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform public.payroll_check_inputs(p_project_id, p_from, p_to);

  return query
  with blocks as (
    select
      g.n                                                                as block_no,
      p_from + 14 * g.n                                                  as block_start,
      least(p_from + 14 * g.n + 13, p_to)                                as block_end,
      date_trunc('month', least(p_from + 14 * g.n + 13, p_to)::timestamp)::date as sheet_month
    from generate_series(0, (p_to - p_from) / 14) as g (n)
  ),
  lines as (
    select * from public.payroll_lines(p_project_id, p_from, p_to)
  ),
  sums as (
    select
      x.block_no,
      count(distinct x.employee_id)     as people,
      sum(x.normal_hours)               as normal_hours,
      sum(x.ot_hours)                   as ot_hours,
      sum(x.total_hours)                as total_hours,
      sum(x.gross)                      as gross,
      sum(x.overtime)                   as overtime,
      sum(x.total_salary)               as total_salary,
      coalesce(sum(x.uif), 0)           as uif,
      sum(x.net)                        as net
    from lines x
    group by x.block_no
  ),
  reps as (
    select ((r.report_date - p_from) / 14)::integer as block_no, count(*) as reports
    from public.daily_reports r
    where r.project_id = p_project_id
      and r.report_date between p_from and p_to
      and r.status = 'submitted'
    group by ((r.report_date - p_from) / 14)::integer
  )
  select
    b.block_no,
    b.block_start,
    b.block_end,
    b.sheet_month,
    (row_number() over (partition by b.sheet_month order by b.block_no))::integer,
    (count(*) over (partition by b.sheet_month))::integer,
    coalesce(r.reports, 0),
    coalesce(s.people, 0),
    coalesce(s.normal_hours, 0),
    coalesce(s.ot_hours, 0),
    coalesce(s.total_hours, 0),
    coalesce(s.gross, 0),
    coalesce(s.overtime, 0),
    coalesce(s.total_salary, 0),
    coalesce(s.uif, 0),
    coalesce(s.net, 0),
    sum(coalesce(s.total_salary, 0)) over (partition by b.sheet_month),
    sum(coalesce(s.net, 0)) over (partition by b.sheet_month),
    sum(coalesce(s.uif, 0)) over (partition by b.sheet_month) * 2
  from blocks b
  left join sums s on s.block_no = b.block_no
  left join reps r on r.block_no = b.block_no
  order by b.block_no;
end;
$$;

-- expense_lines - the expenses statement's rows: APPROVED receipts of the
-- project in the range (pending, rejected and reversed ones are left out),
-- oldest first. Amounts are the total paid, VAT inclusive. PAID BY is
-- always "Company" for now (receipts don't record who paid).
create function public.expense_lines(p_project_id uuid, p_from date, p_to date)
returns table (
  receipt_id     uuid,
  receipt_date   date,
  vendor         text,
  category       text,
  category_label text,
  description    text,
  paid_by        text,
  amount         numeric
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform public.payroll_check_inputs(p_project_id, p_from, p_to);

  return query
  select
    rc.id,
    rc.receipt_date,
    rc.vendor,
    rc.category,
    cc.label,
    nullif(trim(rc.notes), ''),
    'Company'::text,
    a.amount
  from public.receipts rc
  join public.receipt_amounts a on a.receipt_id = rc.id
  join public.cost_categories cc on cc.code = rc.category
  where rc.project_id = p_project_id
    and rc.status = 'approved'
    and rc.receipt_date between p_from and p_to
  order by rc.receipt_date, rc.created_at, rc.id;
end;
$$;

-- expense_totals - the statement's summary figures, in order:
--   'category': Materials, Fuel, Plant hire, Consumables (always, R0.00 if
--               none), then any other receipt category with an amount
--   'reimbursement': per person owed money back - none yet (PAID BY is
--               always Company), then 'reimbursements_total'
--   'grand_total': all approved expenses of the project in the range
create function public.expense_totals(p_project_id uuid, p_from date, p_to date)
returns table (
  section  text,
  label    text,
  amount   numeric,
  sort_order integer
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform public.payroll_check_inputs(p_project_id, p_from, p_to);

  return query
  with lines as (
    select * from public.expense_lines(p_project_id, p_from, p_to)
  ),
  categories as (
    select
      cc.code,
      cc.label,
      coalesce(sum(l.amount), 0) as amount,
      case cc.code
        when 'materials'   then 1
        when 'fuel'        then 2
        when 'plant_hire'  then 3
        when 'consumables' then 4
        else 10 + cc.sort_order
      end as sort_order
    from public.cost_categories cc
    left join lines l on l.category = cc.code
    where cc.source = 'receipts'
    group by cc.code, cc.label, cc.sort_order
  )
  select 'category'::text, c.label, c.amount, c.sort_order
  from categories c
  where c.code in ('materials', 'fuel', 'plant_hire', 'consumables') or c.amount <> 0
  union all
  select 'reimbursements_total'::text, 'Total owed'::text, 0::numeric, 100
  union all
  select 'grand_total'::text, 'GRAND TOTAL'::text, coalesce((select sum(l.amount) from lines l), 0), 101
  order by 4;
end;
$$;

-- Logged-in users may call these (the check inside decides); anonymous
-- visitors may not.
revoke execute on function
  public.round_half_even(numeric),
  public.payroll_check_inputs(uuid, date, date),
  public.payroll_checks(uuid, date, date),
  public.payroll_lines(uuid, date, date),
  public.payroll_blocks(uuid, date, date),
  public.expense_lines(uuid, date, date),
  public.expense_totals(uuid, date, date)
from public, anon;

grant execute on function
  public.round_half_even(numeric),
  public.payroll_check_inputs(uuid, date, date),
  public.payroll_checks(uuid, date, date),
  public.payroll_lines(uuid, date, date),
  public.payroll_blocks(uuid, date, date),
  public.expense_lines(uuid, date, date),
  public.expense_totals(uuid, date, date)
to authenticated;

-- ===========================================================================
-- 7. export_log accepts the two new files ('pay_run' and 'payroll_hours'
--    stay allowed: the log keeps the record of those past exports).
-- ===========================================================================
alter table public.export_log drop constraint export_log_report_type_check;
alter table public.export_log add constraint export_log_report_type_check check (report_type in (
  'project_cost', 'payroll_hours', 'monthly_cost_pack', 'labour_return',
  'delay_register', 'safety_register', 'annual_earnings',
  'my_daily_report', 'my_labour_return', 'pay_run',
  'payroll', 'expenses_statement'));

insert into payroll_exports_log (step, item, detail) values
  ('3. Added', 'daily_reports.all_overtime', 'Sunday / public holiday: every hour on the report is overtime'),
  ('3. Added', 'employees', 'surname, first_names, uif_registered (everyone starts not registered)'),
  ('3. Added', 'payroll and expenses', 'payroll_checks, payroll_lines, payroll_blocks, expense_lines, expense_totals'),
  ('4. Changed', 'labour_days / labour_lines', 'pay rule fixed: 8 h a day, then overtime x1.5'),
  ('4. Changed', 'overtime_warnings', 'limits fixed: over 12 h a day, over 10 overtime hours a week');

commit;

-- What was removed and added (the SQL Editor shows this as the result).
select step, item, detail from payroll_exports_log order by step, item;
