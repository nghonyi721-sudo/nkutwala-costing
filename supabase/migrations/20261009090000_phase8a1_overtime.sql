-- ===========================================================================
-- Phase 8A-1: overtime.
--
--   1. pay_rules: the pay rules, dated (effective_from) with history - never
--      edited, only voided with a reason, like rates. Each day uses the rule
--      in force on that day, so a later change never alters past days.
--      ON:  daily overtime above 8 h at x1.5.
--      OFF: weekly overtime above 45 h, Sunday x2.0, public holiday x2.0.
--      Also the warning limits (shown in 8A-2): over 10 OT h a week, over
--      12 h a day - warnings only, never blocking.
--   2. public_holidays: South Africa's public holidays (used when the
--      holiday rule is ON). Void-only.
--   3. labour_days: per person per date - all submitted hours that day across
--      all reports and projects, split into ordinary / overtime / premium
--      (Sunday or holiday) hours and pay at the rate on that day.
--   4. labour_lines: each report line's share of its day (by its share of the
--      day's hours). The project with the most hours that day takes any
--      leftover cent, so the projects always add up to the day exactly.
--   5. Labour cost everywhere now comes from labour_lines: project_cost_lines
--      (and so the dashboard, drill-down and exports), the weekly labour
--      view, the employee month summary. Overtime is reported separately.
--
-- Owner/system_admin only throughout (site managers get nothing). Views keep
-- security_invoker = true; functions are SECURITY INVOKER with the role
-- check. People without an approved rate are unpriced, as before.
-- All-or-nothing.
-- ===========================================================================

begin;

-- ===========================================================================
-- 1. pay_rules
-- ===========================================================================
create table public.pay_rules (
  id                         uuid primary key default gen_random_uuid(),
  company_id                 uuid not null default public.current_user_company_id()
                             references public.companies (id),
  effective_from             date not null,
  -- Daily overtime (ON)
  daily_ot_threshold_hours   numeric(4, 2) not null default 8
                             check (daily_ot_threshold_hours > 0 and daily_ot_threshold_hours <= 24),
  ot_multiplier              numeric(4, 2) not null default 1.5
                             check (ot_multiplier >= 1 and ot_multiplier <= 5),
  -- Weekly overtime (built, OFF)
  weekly_ot_enabled          boolean not null default false,
  weekly_ot_threshold_hours  numeric(5, 2) not null default 45
                             check (weekly_ot_threshold_hours > 0 and weekly_ot_threshold_hours <= 168),
  -- Sunday and public holiday rates (built, OFF)
  sunday_enabled             boolean not null default false,
  sunday_multiplier          numeric(4, 2) not null default 2.0
                             check (sunday_multiplier >= 1 and sunday_multiplier <= 5),
  public_holiday_enabled     boolean not null default false,
  public_holiday_multiplier  numeric(4, 2) not null default 2.0
                             check (public_holiday_multiplier >= 1 and public_holiday_multiplier <= 5),
  -- Warnings only, never blocking (shown in 8A-2)
  warn_weekly_ot_hours       numeric(5, 2) not null default 10 check (warn_weekly_ot_hours > 0),
  warn_daily_hours           numeric(4, 2) not null default 12
                             check (warn_daily_hours > 0 and warn_daily_hours <= 24),
  -- Stamped by the database
  created_by                 uuid references public.profiles (id),
  created_at                 timestamptz not null default now(),
  voided_at                  timestamptz,
  voided_by                  uuid references public.profiles (id),
  void_reason                text,
  constraint pay_rules_void_needs_reason
    check (voided_at is null or length(trim(coalesce(void_reason, ''))) > 0)
);

-- One LIVE rule per start date (a wrong one is voided, then re-entered).
create unique index pay_rules_one_live_per_date
  on public.pay_rules (company_id, effective_from)
  where voided_at is null;

-- New rules are stamped; afterwards the only change ever allowed is voiding.
create function public.pay_rules_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by  := auth.uid();
    new.created_at  := now();
    new.voided_at   := null;
    new.voided_by   := null;
    new.void_reason := null;
    return new;
  end if;

  if old.voided_at is not null then
    raise exception 'This pay rule is already voided.' using errcode = '23514';
  end if;
  if (new.company_id, new.effective_from, new.daily_ot_threshold_hours, new.ot_multiplier,
      new.weekly_ot_enabled, new.weekly_ot_threshold_hours, new.sunday_enabled, new.sunday_multiplier,
      new.public_holiday_enabled, new.public_holiday_multiplier, new.warn_weekly_ot_hours,
      new.warn_daily_hours, new.created_by, new.created_at)
     is distinct from
     (old.company_id, old.effective_from, old.daily_ot_threshold_hours, old.ot_multiplier,
      old.weekly_ot_enabled, old.weekly_ot_threshold_hours, old.sunday_enabled, old.sunday_multiplier,
      old.public_holiday_enabled, old.public_holiday_multiplier, old.warn_weekly_ot_hours,
      old.warn_daily_hours, old.created_by, old.created_at) then
    raise exception 'Pay rules cannot be edited. Void the rule and add a new one from a date.' using errcode = '42501';
  end if;
  if length(trim(coalesce(new.void_reason, ''))) = 0 then
    raise exception 'A reason is required to void a pay rule.' using errcode = '23514';
  end if;

  new.voided_at := now();
  new.voided_by := auth.uid();
  return new;
end;
$$;

revoke execute on function public.pay_rules_before_write() from public, anon, authenticated;

create trigger pay_rules_rules
  before insert or update on public.pay_rules
  for each row execute function public.pay_rules_before_write();

create trigger audit_pay_rules
  after insert or update or delete on public.pay_rules
  for each row execute function public.audit_row_change();

revoke all on public.pay_rules from anon, authenticated;
grant select on public.pay_rules to authenticated;
grant insert (effective_from, daily_ot_threshold_hours, ot_multiplier, weekly_ot_enabled,
  weekly_ot_threshold_hours, sunday_enabled, sunday_multiplier, public_holiday_enabled,
  public_holiday_multiplier, warn_weekly_ot_hours, warn_daily_hours) on public.pay_rules to authenticated;
grant update (void_reason) on public.pay_rules to authenticated;

alter table public.pay_rules enable row level security;

create policy "Owners and system admins read pay rules"
  on public.pay_rules for select to authenticated
  using (
    (select public.current_user_role()) in ('owner', 'system_admin')
    and company_id = (select public.current_user_company_id())
  );

create policy "Owners and system admins add pay rules"
  on public.pay_rules for insert to authenticated
  with check (
    (select public.current_user_role()) in ('owner', 'system_admin')
    and company_id = (select public.current_user_company_id())
  );

create policy "Owners and system admins void pay rules"
  on public.pay_rules for update to authenticated
  using (
    (select public.current_user_role()) in ('owner', 'system_admin')
    and company_id = (select public.current_user_company_id())
  )
  with check (
    (select public.current_user_role()) in ('owner', 'system_admin')
    and company_id = (select public.current_user_company_id())
  );

-- The first rule for every company: from 1 Jan 2000, so all days so far
-- (and the test data) are worked out with it. Defaults as above.
insert into public.pay_rules (company_id, effective_from)
select c.id, date '2000-01-01'
from public.companies c;

-- ===========================================================================
-- 2. public_holidays (used only while the holiday rule is ON)
-- ===========================================================================
create table public.public_holidays (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null default public.current_user_company_id()
               references public.companies (id),
  holiday_date date not null,
  name         text not null check (length(trim(name)) > 0),
  created_by   uuid references public.profiles (id),
  created_at   timestamptz not null default now(),
  voided_at    timestamptz,
  voided_by    uuid references public.profiles (id),
  void_reason  text,
  constraint public_holidays_void_needs_reason
    check (voided_at is null or length(trim(coalesce(void_reason, ''))) > 0)
);

create unique index public_holidays_one_live_per_date
  on public.public_holidays (company_id, holiday_date)
  where voided_at is null;

create function public.public_holidays_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by  := auth.uid();
    new.created_at  := now();
    new.voided_at   := null;
    new.voided_by   := null;
    new.void_reason := null;
    return new;
  end if;

  if old.voided_at is not null then
    raise exception 'This holiday is already voided.' using errcode = '23514';
  end if;
  if (new.company_id, new.holiday_date, new.name, new.created_by, new.created_at)
     is distinct from (old.company_id, old.holiday_date, old.name, old.created_by, old.created_at) then
    raise exception 'Holidays cannot be edited. Void it and add the correct one.' using errcode = '42501';
  end if;
  if length(trim(coalesce(new.void_reason, ''))) = 0 then
    raise exception 'A reason is required to void a holiday.' using errcode = '23514';
  end if;

  new.voided_at := now();
  new.voided_by := auth.uid();
  return new;
end;
$$;

revoke execute on function public.public_holidays_before_write() from public, anon, authenticated;

create trigger public_holidays_rules
  before insert or update on public.public_holidays
  for each row execute function public.public_holidays_before_write();

create trigger audit_public_holidays
  after insert or update or delete on public.public_holidays
  for each row execute function public.audit_row_change();

revoke all on public.public_holidays from anon, authenticated;
grant select on public.public_holidays to authenticated;
grant insert (holiday_date, name) on public.public_holidays to authenticated;
grant update (void_reason) on public.public_holidays to authenticated;

alter table public.public_holidays enable row level security;

create policy "Owners and system admins read public holidays"
  on public.public_holidays for select to authenticated
  using (
    (select public.current_user_role()) in ('owner', 'system_admin')
    and company_id = (select public.current_user_company_id())
  );

create policy "Owners and system admins add public holidays"
  on public.public_holidays for insert to authenticated
  with check (
    (select public.current_user_role()) in ('owner', 'system_admin')
    and company_id = (select public.current_user_company_id())
  );

create policy "Owners and system admins void public holidays"
  on public.public_holidays for update to authenticated
  using (
    (select public.current_user_role()) in ('owner', 'system_admin')
    and company_id = (select public.current_user_company_id())
  )
  with check (
    (select public.current_user_role()) in ('owner', 'system_admin')
    and company_id = (select public.current_user_company_id())
  );

-- South Africa's public holidays, 2026 and 2027 (Public Holidays Act: a
-- holiday on a Sunday makes the Monday a holiday too).
insert into public.public_holidays (company_id, holiday_date, name)
select c.id, h.holiday_date::date, h.name
from public.companies c
cross join (values
  ('2026-01-01', 'New Year''s Day'),
  ('2026-03-21', 'Human Rights Day'),
  ('2026-04-03', 'Good Friday'),
  ('2026-04-06', 'Family Day'),
  ('2026-04-27', 'Freedom Day'),
  ('2026-05-01', 'Workers'' Day'),
  ('2026-06-16', 'Youth Day'),
  ('2026-08-09', 'National Women''s Day'),
  ('2026-08-10', 'National Women''s Day (Monday holiday)'),
  ('2026-09-24', 'Heritage Day'),
  ('2026-12-16', 'Day of Reconciliation'),
  ('2026-12-25', 'Christmas Day'),
  ('2026-12-26', 'Day of Goodwill'),
  ('2027-01-01', 'New Year''s Day'),
  ('2027-03-21', 'Human Rights Day'),
  ('2027-03-22', 'Human Rights Day (Monday holiday)'),
  ('2027-03-26', 'Good Friday'),
  ('2027-03-29', 'Family Day'),
  ('2027-04-27', 'Freedom Day'),
  ('2027-05-01', 'Workers'' Day'),
  ('2027-06-16', 'Youth Day'),
  ('2027-08-09', 'National Women''s Day'),
  ('2027-09-24', 'Heritage Day'),
  ('2027-12-16', 'Day of Reconciliation'),
  ('2027-12-25', 'Christmas Day'),
  ('2027-12-26', 'Day of Goodwill'),
  ('2027-12-27', 'Day of Goodwill (Monday holiday)')
) as h (holiday_date, name);

-- ===========================================================================
-- 3. labour_days - per person per date: the day's hours split and paid.
--    total_hours: all SUBMITTED hours that day, all reports and projects
--                 (Absent 0 h lines don't count)
--    rate:        rate_on(person, day) - null = unpriced (no approved rate)
--    ordinary / ot / premium hours and pay; total_pay = their sum.
--      Normal day:  ordinary = up to the daily threshold, ot = the rest x ot
--                   multiplier. Weekly rule (when ON): ordinary hours above
--                   the weekly threshold (Mon-Sun, counted in date order)
--                   become overtime too.
--      Sunday / public holiday (when ON): every hour at that multiplier
--                   (premium); a holiday wins over a Sunday.
-- ===========================================================================
create view public.labour_days
with (security_invoker = true)
as
with days as (
  select r.company_id, c.employee_id, r.report_date as day, sum(c.hours) as total_hours
  from public.daily_reports r
  join public.report_crew c on c.report_id = r.id
  where r.status = 'submitted'
    and c.hours > 0
  group by r.company_id, c.employee_id, r.report_date
),
ruled as (
  select
    d.company_id,
    d.employee_id,
    d.day,
    d.total_hours,
    public.rate_on(d.employee_id, d.day) as rate,
    pr.id                                as rule_id,
    pr.daily_ot_threshold_hours          as threshold,
    pr.ot_multiplier,
    pr.weekly_ot_enabled,
    pr.weekly_ot_threshold_hours,
    case
      when pr.public_holiday_enabled and h.id is not null then 'public_holiday'
      when pr.sunday_enabled and extract(isodow from d.day) = 7 then 'sunday'
    end as premium_kind,
    case
      when pr.public_holiday_enabled and h.id is not null then pr.public_holiday_multiplier
      when pr.sunday_enabled and extract(isodow from d.day) = 7 then pr.sunday_multiplier
    end as premium_multiplier
  from days d
  left join lateral (
    select p.*
    from public.pay_rules p
    where p.company_id = d.company_id
      and p.effective_from <= d.day
      and p.voided_at is null
    order by p.effective_from desc
    limit 1
  ) pr on true
  left join public.public_holidays h
    on h.company_id = d.company_id
   and h.holiday_date = d.day
   and h.voided_at is null
),
daily as (
  select
    x.*,
    case when x.premium_kind is null then least(x.total_hours, x.threshold) else 0 end           as daily_ordinary,
    case when x.premium_kind is null then greatest(x.total_hours - x.threshold, 0) else 0 end    as daily_ot,
    case when x.premium_kind is not null then x.total_hours else 0 end                           as premium_hours
  from ruled x
),
weekly as (
  select
    y.*,
    case
      when y.weekly_ot_enabled then
        greatest(0, least(
          y.daily_ordinary,
          sum(y.daily_ordinary) over (
            partition by y.employee_id, date_trunc('week', y.day)
            order by y.day
            rows between unbounded preceding and current row
          ) - y.weekly_ot_threshold_hours
        ))
      else 0
    end as weekly_ot
  from daily y
),
split as (
  select
    w.*,
    w.daily_ordinary - w.weekly_ot as ordinary_hours,
    w.daily_ot + w.weekly_ot       as ot_hours
  from weekly w
)
select
  s.company_id,
  s.employee_id,
  s.day,
  s.total_hours,
  s.rate,
  s.rule_id,
  s.ordinary_hours,
  s.ot_hours,
  s.premium_hours,
  s.premium_kind,
  s.ot_multiplier,
  s.premium_multiplier,
  round(s.ordinary_hours * s.rate, 2)                                  as ordinary_pay,
  round(s.ot_hours * s.rate * s.ot_multiplier, 2)                      as ot_pay,
  round(s.premium_hours * s.rate * coalesce(s.premium_multiplier, 1), 2) as premium_pay,
  round(s.ordinary_hours * s.rate, 2)
    + round(s.ot_hours * s.rate * s.ot_multiplier, 2)
    + round(s.premium_hours * s.rate * coalesce(s.premium_multiplier, 1), 2) as total_pay
from split s
where (select public.current_user_role()) in ('owner', 'system_admin');

-- ===========================================================================
-- 4. labour_lines - each submitted report line's share of its day.
--    A line gets its share (line hours / day hours) of the day's ordinary,
--    overtime and premium hours and pay, rounded to cents; the line with
--    the most hours that day takes the leftover so lines add up exactly.
--    amount = ordinary_pay + ot_pay + premium_pay (null when unpriced).
-- ===========================================================================
create view public.labour_lines
with (security_invoker = true)
as
with lines as (
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
  join public.labour_days d on d.employee_id = l.employee_id and d.day = l.day
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

-- ===========================================================================
-- 5. project_cost_lines - labour now from labour_lines (overtime included).
--    New last columns: ordinary_hours, ot_hours, premium_hours, ot_amount,
--    premium_amount (labour only). Its two dependent views are rebuilt
--    exactly as they were (from 20261005120000 / 20261007090000).
-- ===========================================================================
drop view public.project_cost_vs_budget;
drop view public.project_cost_by_week;
drop view public.project_cost_lines;

create view public.project_cost_lines
with (security_invoker = true)
as
-- Labour: crew hours on SUBMITTED reports, paid by the day under the pay
-- rules (ordinary + overtime + Sunday/holiday) at the rate on that day.
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

-- ===========================================================================
-- 6. labour_provisional_by_employee_week - pay from labour_days now.
--    New last columns: ot_hours, ot_pay.
-- ===========================================================================
drop view public.labour_provisional_by_employee_week;

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
  'PROVISIONAL: hours x rate, overtime included per the pay rules, before deductions'::text as basis,
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
-- 7. employee_month_summary - one person's month (optionally one project):
--    hours, pay with overtime, unpriced hours, overtime hours and pay.
-- ===========================================================================
drop function public.employee_month_summary(uuid, date, uuid);

create function public.employee_month_summary(p_employee_id uuid, p_month date, p_project_id uuid default null)
returns table (
  total_hours      numeric,
  provisional_cost numeric,
  unpriced_hours   numeric,
  ot_hours         numeric,
  ot_pay           numeric,
  basis            text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select m.total_hours, m.provisional_cost, m.unpriced_hours, m.ot_hours, m.ot_pay, m.basis
  from (
    select
      coalesce(sum(l.hours), 0)                                 as total_hours,
      coalesce(sum(l.amount), 0)                                as provisional_cost,
      coalesce(sum(l.hours) filter (where l.rate is null), 0)   as unpriced_hours,
      coalesce(sum(l.ot_hours) filter (where l.rate is not null), 0) as ot_hours,
      coalesce(sum(l.ot_pay), 0)                                as ot_pay,
      'PROVISIONAL - overtime included, before deductions'::text as basis
    from public.labour_lines l
    where l.employee_id = p_employee_id
      and l.day >= date_trunc('month', p_month::timestamp)::date
      and l.day < (date_trunc('month', p_month::timestamp) + interval '1 month')::date
      and (p_project_id is null or l.project_id = p_project_id)
  ) m
  -- Outside the totals, so anyone else gets no row at all (not a row of zeros).
  where public.current_user_role() in ('owner', 'system_admin');
$$;

-- ===========================================================================
-- 8. dashboard_summary - as in 20261006090000, plus overtime in the period.
-- ===========================================================================
drop function public.dashboard_summary(uuid, date, date);

create function public.dashboard_summary(p_project_id uuid, p_from date, p_to date)
returns table (
  budget             numeric,
  spent              numeric,
  spent_to_date      numeric,
  remaining          numeric,
  percent_used       numeric,
  unpriced_hours     numeric,
  missing_rate_items bigint,
  ot_hours           numeric,
  ot_pay             numeric
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
    coalesce(unpriced.items, 0),
    coalesce(in_range.ot_hours, 0),
    coalesce(in_range.ot_pay, 0)
  from
    (select sum(pb.amount) as amount
       from public.project_budgets pb
      where p_project_id is null or pb.project_id = p_project_id) b
  cross join
    (select sum(l.amount) as amount, sum(l.ot_hours) as ot_hours, sum(l.ot_amount) as ot_pay
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
-- 9. drill_hours and drill_employee_days - as in 20261007150000, plus the
--    ordinary / overtime split (labour only).
-- ===========================================================================
drop function public.drill_hours(uuid, date, date, text);

create function public.drill_hours(p_project_id uuid, p_from date, p_to date, p_category text)
returns table (
  who_id               uuid,
  name                 text,
  status               text,
  hours                numeric,
  priced_hours         numeric,
  unpriced_hours       numeric,
  days                 bigint,
  rates                numeric[],
  cost                 numeric,
  ordinary_hours       numeric,
  ot_hours             numeric,
  ot_pay               numeric,
  total_hours          numeric,
  total_unpriced_hours numeric,
  total_cost           numeric,
  total_ot_hours       numeric,
  total_ot_pay         numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with lines as (
    select
      coalesce(l.employee_id, l.equipment_id) as who_id,
      l.cost_date                             as day,
      l.hours                                 as priced,
      0::numeric                              as unpriced,
      l.unit_rate,
      l.amount,
      coalesce(l.ordinary_hours, l.hours)     as ordinary,
      coalesce(l.ot_hours, 0)                 as ot,
      coalesce(l.ot_amount, 0)                as ot_amount
    from public.project_cost_lines l
    where p_category in ('labour', 'owned_plant')
      and l.category = p_category
      and l.hours > 0
      and l.cost_date between p_from and p_to
      and (p_project_id is null or l.project_id = p_project_id)

    union all

    select
      coalesce(u.employee_id, u.equipment_id),
      u.report_date,
      0::numeric,
      u.hours,
      null::numeric,
      0::numeric,
      0::numeric,
      0::numeric,
      0::numeric
    from public.unpriced_hours u
    where p_category in ('labour', 'owned_plant')
      and u.category = p_category
      and u.report_date between p_from and p_to
      and (p_project_id is null or u.project_id = p_project_id)
  )
  select
    x.who_id,
    coalesce(e.full_name, q.name),
    coalesce(e.status, case when q.active then 'active' else 'inactive' end),
    sum(x.priced) + sum(x.unpriced),
    sum(x.priced),
    sum(x.unpriced),
    count(distinct x.day),
    coalesce(array_agg(distinct x.unit_rate order by x.unit_rate) filter (where x.unit_rate is not null), '{}'),
    sum(x.amount),
    sum(x.ordinary),
    sum(x.ot),
    sum(x.ot_amount),
    sum(sum(x.priced) + sum(x.unpriced)) over (),
    sum(sum(x.unpriced)) over (),
    sum(sum(x.amount)) over (),
    sum(sum(x.ot)) over (),
    sum(sum(x.ot_amount)) over ()
  from lines x
  left join public.employees e on p_category = 'labour' and e.id = x.who_id
  left join public.equipment q on p_category = 'owned_plant' and q.id = x.who_id
  where public.current_user_role() in ('owner', 'system_admin')
  group by x.who_id, e.full_name, e.status, q.name, q.active
  order by sum(x.amount) desc, coalesce(e.full_name, q.name);
$$;

drop function public.drill_employee_days(uuid, uuid, date, date);

create function public.drill_employee_days(p_employee_id uuid, p_project_id uuid, p_from date, p_to date)
returns table (
  day                  date,
  hours                numeric,
  unpriced_hours       numeric,
  projects             text,
  rate                 numeric,
  cost                 numeric,
  reports              jsonb,
  ordinary_hours       numeric,
  ot_hours             numeric,
  ot_pay               numeric,
  total_hours          numeric,
  total_unpriced_hours numeric,
  total_cost           numeric,
  total_ot_hours       numeric,
  total_ot_pay         numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with lines as (
    select l.cost_date as day, l.project_id, l.report_id, l.hours as priced, 0::numeric as unpriced, l.amount,
           l.ordinary_hours as ordinary, l.ot_hours as ot, l.ot_amount
    from public.project_cost_lines l
    where l.category = 'labour'
      and l.employee_id = p_employee_id
      and l.hours > 0
      and l.cost_date between p_from and p_to
      and (p_project_id is null or l.project_id = p_project_id)

    union all

    select u.report_date, u.project_id, u.report_id, 0::numeric, u.hours, 0::numeric,
           0::numeric, 0::numeric, 0::numeric
    from public.unpriced_hours u
    where u.category = 'labour'
      and u.employee_id = p_employee_id
      and u.report_date between p_from and p_to
      and (p_project_id is null or u.project_id = p_project_id)
  )
  select
    x.day,
    sum(x.priced) + sum(x.unpriced),
    sum(x.unpriced),
    string_agg(distinct p.name, ', ' order by p.name),
    public.rate_on(p_employee_id, x.day),
    sum(x.amount),
    jsonb_agg(
      jsonb_build_object('report_id', x.report_id, 'project_name', p.name, 'hours', x.priced + x.unpriced)
      order by p.name
    ),
    sum(x.ordinary),
    sum(x.ot),
    sum(x.ot_amount),
    sum(sum(x.priced) + sum(x.unpriced)) over (),
    sum(sum(x.unpriced)) over (),
    sum(sum(x.amount)) over (),
    sum(sum(x.ot)) over (),
    sum(sum(x.ot_amount)) over ()
  from lines x
  join public.projects p on p.id = x.project_id
  where public.current_user_role() in ('owner', 'system_admin')
  group by x.day
  order by x.day;
$$;

-- ===========================================================================
-- 10. export_labour and export_payroll - as in 20261008090000, plus the
--     ordinary / overtime / premium split.
-- ===========================================================================
drop function public.export_payroll(date, date);
drop function public.export_labour(uuid, date, date);

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
  ordinary_hours       numeric,
  ot_hours             numeric,
  premium_hours        numeric,
  rates                jsonb,
  ordinary_pay         numeric,
  ot_pay               numeric,
  premium_pay          numeric,
  cost                 numeric,
  total_hours          numeric,
  total_unpriced_hours numeric,
  total_ordinary_hours numeric,
  total_ot_hours       numeric,
  total_premium_hours  numeric,
  total_ordinary_pay   numeric,
  total_ot_pay         numeric,
  total_premium_pay    numeric,
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
      and (p_project_id is null or l.project_id = p_project_id)

    union all

    select u.employee_id, u.report_date, 0::numeric, u.hours, 0::numeric, 0::numeric, 0::numeric,
           0::numeric, 0::numeric, 0::numeric, 0::numeric, null::numeric, null::date
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
    sum(x.ordinary),
    sum(x.ot),
    sum(x.premium),
    coalesce(r.rates, '[]'::jsonb),
    sum(x.ordinary_pay),
    sum(x.ot_pay),
    sum(x.premium_pay),
    sum(x.amount),
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
  left join rates r on r.employee_id = x.employee_id
  where public.current_user_role() in ('owner', 'system_admin')
  group by x.employee_id, e.full_name, e.category, e.status, e.approved_at, r.rates
  order by e.full_name;
$$;

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
  ordinary_hours       numeric,
  ot_hours             numeric,
  premium_hours        numeric,
  rates                jsonb,
  ordinary_pay         numeric,
  ot_pay               numeric,
  premium_pay          numeric,
  gross                numeric,
  total_hours          numeric,
  total_unpriced_hours numeric,
  total_ordinary_hours numeric,
  total_ot_hours       numeric,
  total_premium_hours  numeric,
  total_ordinary_pay   numeric,
  total_ot_pay         numeric,
  total_premium_pay    numeric,
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
    l.ordinary_hours,
    l.ot_hours,
    l.premium_hours,
    l.rates,
    l.ordinary_pay,
    l.ot_pay,
    l.premium_pay,
    l.cost,
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
  from public.export_labour(null, p_from, p_to) l
  where public.current_user_role() in ('owner', 'system_admin')
  order by l.approved desc, l.full_name;
$$;

-- ===========================================================================
-- 11. Permissions for the recreated functions: logged-in users may call them
--     (the check inside decides who gets anything); anonymous visitors may not.
-- ===========================================================================
revoke execute on function
  public.employee_month_summary(uuid, date, uuid),
  public.dashboard_summary(uuid, date, date),
  public.drill_hours(uuid, date, date, text),
  public.drill_employee_days(uuid, uuid, date, date),
  public.export_labour(uuid, date, date),
  public.export_payroll(date, date)
from public, anon;

grant execute on function
  public.employee_month_summary(uuid, date, uuid),
  public.dashboard_summary(uuid, date, date),
  public.drill_hours(uuid, date, date, text),
  public.drill_employee_days(uuid, uuid, date, date),
  public.export_labour(uuid, date, date),
  public.export_payroll(date, date)
to authenticated;

commit;

-- The pay rules now in force (the SQL Editor shows this as the result).
select effective_from, daily_ot_threshold_hours, ot_multiplier, weekly_ot_enabled,
       sunday_enabled, public_holiday_enabled
from public.pay_rules
where voided_at is null
order by effective_from;
