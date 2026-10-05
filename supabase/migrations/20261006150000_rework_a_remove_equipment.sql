-- Rework slice A: equipment, plant and the "diver" category come out of the app.
--
-- Run once in the Supabase SQL Editor of the DEV project
-- (after 20261006120000_dashboard_insights.sql). Earlier migration files are
-- NOT edited - this file changes what they built.
--
-- What it does:
--   1. Moves data, logging every move (audit_log and budget_changes record
--      each change too):
--        * plant_hire receipts            -> other   (no receipt is deleted)
--        * owned_plant / plant_hire budgets -> added into each project's other
--        * employees in "diver"            -> general_worker (listed to recategorise)
--   2. ARCHIVES - does not delete - the equipment, report_equipment and
--      equipment_rates tables, the old plant budget lines and the two plant
--      categories: they move into a private "archive" schema that the app
--      and its API cannot see or reach. "Nothing is ever hard-deleted."
--   3. Removes the equipment functions, and the plant parts of the cost views
--      and dashboard functions (recreated without plant; every view keeps
--      security_invoker = true and its owner/admin check).
--   4. Cost categories become: labour, fuel, materials, consumables, food,
--      other. Employee categories: site_manager, site_agent, operator,
--      semi_skilled, general_worker. Fuel litres on daily reports stay.
--
-- When it finishes, the editor shows a list of everything moved or archived.
-- Wrapped in a transaction: if anything fails, nothing is applied.

begin;

-- A list of what this file changes, shown at the very end.
create temporary table rework_a_log (step text, item text, detail text) on commit preserve rows;

-- ===========================================================================
-- 1. The private archive: kept data the app can never see.
-- ===========================================================================
create schema if not exists archive;
revoke all on schema archive from public, anon, authenticated;
comment on schema archive is
  'Data taken out of the app but kept (nothing is ever hard-deleted). Not reachable by the app or its API.';

-- ===========================================================================
-- 2. Receipts: plant_hire -> other. Submitted receipts are normally locked,
--    so the lock is switched off for this one update only, then back on.
--    The audit log records each change.
-- ===========================================================================
insert into rework_a_log (step, item, detail)
select '1. Receipt moved from Plant hire to Other', r.id::text,
       concat(r.receipt_date, ' · ', r.vendor, ' · ', r.status)
from public.receipts r
where r.category = 'plant_hire';

alter table public.receipts disable trigger receipts_guard_update;
update public.receipts set category = 'other' where category = 'plant_hire';
alter table public.receipts enable trigger receipts_guard_update;

-- ===========================================================================
-- 3. Budgets: each project's owned_plant + plant_hire amounts are added into
--    its "other" line (created if needed), so budget totals don't change.
--    The old lines are kept in the archive. budget_changes logs each change.
-- ===========================================================================
create table archive.project_budgets_plant as
select * from public.project_budgets
where category in ('owned_plant', 'plant_hire');

insert into rework_a_log (step, item, detail)
select '2. Budget line added into Other', b.id::text,
       concat(p.name, ' · ', b.category, ' · R', b.amount)
from public.project_budgets b
join public.projects p on p.id = b.project_id
where b.category in ('owned_plant', 'plant_hire');

insert into public.project_budgets as pb (company_id, project_id, category, amount)
select b.company_id, b.project_id, 'other', sum(b.amount)
from public.project_budgets b
where b.category in ('owned_plant', 'plant_hire')
group by b.company_id, b.project_id
on conflict (project_id, category) do update
  set amount = pb.amount + excluded.amount;

delete from public.project_budgets where category in ('owned_plant', 'plant_hire');

-- Past budget_changes rows keep saying owned_plant / plant_hire: history is
-- not rewritten, so the log no longer has to match the category list.
alter table public.budget_changes drop constraint if exists budget_changes_category_fkey;

-- ===========================================================================
-- 4. Employees: "diver" -> general_worker. Listed so they can be
--    recategorised. The audit log records each change.
-- ===========================================================================
insert into rework_a_log (step, item, detail)
select '3. Employee was Diver, now General worker - please recategorise', e.id::text, e.full_name
from public.employees e
where e.category = 'diver';

update public.employees set category = 'general_worker' where category = 'diver';

-- ===========================================================================
-- 5. The category lists. The two plant categories are kept in the archive.
-- ===========================================================================
create table archive.cost_categories_removed as
select * from public.cost_categories
where code in ('owned_plant', 'plant_hire');

delete from public.cost_categories where code in ('owned_plant', 'plant_hire');

-- Replace the old allowed-value checks (found by what they contain, so the
-- exact names Postgres gave them don't matter).
do $$
declare
  c record;
begin
  for c in
    select con.conname, con.conrelid::regclass as tbl
    from pg_constraint con
    where con.contype = 'c'
      and con.conrelid in ('public.receipts'::regclass, 'public.employees'::regclass)
      and (pg_get_constraintdef(con.oid) like '%plant_hire%'
        or pg_get_constraintdef(con.oid) like '%diver%')
  loop
    execute format('alter table %s drop constraint %I', c.tbl, c.conname);
  end loop;
end
$$;

alter table public.receipts
  add constraint receipts_category_check
  check (category in ('fuel', 'materials', 'consumables', 'food', 'other'));

alter table public.employees
  add constraint employees_category_check
  check (category in ('site_manager', 'site_agent', 'operator', 'semi_skilled', 'general_worker'));

-- ===========================================================================
-- 6. Equipment tables -> archive (rows intact). Their live logic (triggers)
--    goes first; the app loses all access.
-- ===========================================================================
insert into rework_a_log (step, item, detail)
select '4. Archived (kept, no longer in the app)', 'equipment', count(*) || ' machine(s)' from public.equipment
union all
select '4. Archived (kept, no longer in the app)', 'report_equipment', count(*) || ' plant line(s) on daily reports' from public.report_equipment
union all
select '4. Archived (kept, no longer in the app)', 'equipment_rates', count(*) || ' equipment rate(s)' from public.equipment_rates
union all
select '4. Archived (kept, no longer in the app)', 'project_budgets_plant', count(*) || ' old plant budget line(s)' from archive.project_budgets_plant
union all
select '4. Archived (kept, no longer in the app)', 'cost_categories_removed', count(*) || ' categories (owned plant, plant hire)' from archive.cost_categories_removed;

-- The cost views read report_equipment, so they go first (rebuilt in 9).
drop view public.project_cost_vs_budget;
drop view public.project_cost_by_week;
drop view public.project_cost_lines;
drop view public.unpriced_hours;

drop trigger if exists audit_equipment on public.equipment;
drop trigger if exists audit_report_equipment on public.report_equipment;
drop trigger if exists audit_equipment_rates on public.equipment_rates;
drop trigger if exists equipment_rates_owned_only on public.equipment_rates;
drop trigger if exists equipment_rates_void_only on public.equipment_rates;

alter table public.equipment set schema archive;
alter table public.report_equipment set schema archive;
alter table public.equipment_rates set schema archive;

revoke all on archive.equipment, archive.report_equipment, archive.equipment_rates,
  archive.project_budgets_plant, archive.cost_categories_removed
  from public, anon, authenticated;

-- ===========================================================================
-- 7. Equipment functions go. save_report_draft loses its equipment list.
-- ===========================================================================
drop function public.equipment_rate_on(uuid, date);
drop function public.equipment_rates_before_insert();
drop function public.equipment_rates_before_update();
drop function public.save_report_draft(jsonb, jsonb, jsonb);
drop function public.dashboard_weekly_mix(uuid, date, date);

-- Audit: no equipment branches any more. (Otherwise as before.)
create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row     jsonb := to_jsonb(coalesce(new, old));
  v_company uuid;
begin
  if tg_table_name = 'companies' then
    v_company := (v_row ->> 'id')::uuid;
  elsif tg_table_name = 'employee_rates' then
    select e.company_id into v_company
    from public.employees e
    where e.id = (v_row ->> 'employee_id')::uuid;
  elsif tg_table_name = 'report_crew' then
    select r.company_id into v_company
    from public.daily_reports r
    where r.id = (v_row ->> 'report_id')::uuid;
  else
    v_company := (v_row ->> 'company_id')::uuid;
  end if;

  insert into public.audit_log (company_id, actor, action, entity, entity_id, before, after)
  values (
    v_company,
    auth.uid(),
    tg_op,
    tg_table_name,
    (v_row ->> 'id')::uuid,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );

  return coalesce(new, old);
end;
$$;

revoke execute on function public.audit_row_change() from public, anon, authenticated;

-- ===========================================================================
-- 8. save_report_draft(report, crew) - saves the report AND its full crew
--    list in one all-or-nothing step. SECURITY INVOKER: every rule on the
--    report tables applies as if the app wrote them itself.
--    p_report: { id (null for new), project_id, report_date, start_time,
--                end_time, rain_percent, delay_hours, fuel_litres, dsti_done,
--                internal_audit, near_miss, safety_moment, activities }
--    p_crew:   [ { employee_id, hours }, ... ]  - the complete list
--    Returns the report id.
-- ===========================================================================
create function public.save_report_draft(p_report jsonb, p_crew jsonb)
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
      fuel_litres, dsti_done, internal_audit, near_miss, safety_moment, activities
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
      coalesce(p_report ->> 'activities', '')
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
      activities     = coalesce(p_report ->> 'activities', '')
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

  return v_id;
end;
$$;

revoke execute on function public.save_report_draft(jsonb, jsonb) from public, anon;
grant execute on function public.save_report_draft(jsonb, jsonb) to authenticated;

-- ===========================================================================
-- 9. Cost views, rebuilt without plant. Every one: security_invoker = true
--    plus the explicit owner/admin check - a site manager gets zero rows.
-- ===========================================================================

-- Every priced cost line: labour (crew hours on SUBMITTED reports x the rate
-- on that day) and APPROVED receipts (total paid, VAT inclusive).
create view public.project_cost_lines
with (security_invoker = true)
as
select
  r.company_id,
  r.project_id,
  'labour'::text      as category,
  r.report_date       as cost_date,
  r.id                as report_id,
  c.employee_id,
  null::uuid          as receipt_id,
  null::text          as vendor,
  c.hours,
  rate.hourly_rate    as unit_rate,
  round(c.hours * rate.hourly_rate, 2) as amount
from public.daily_reports r
join public.report_crew c on c.report_id = r.id
cross join lateral (select public.rate_on(c.employee_id, r.report_date) as hourly_rate) rate
where r.status = 'submitted'
  and rate.hourly_rate is not null
  and (select public.current_user_role()) in ('owner', 'system_admin')

union all

select
  rc.company_id,
  rc.project_id,
  rc.category,
  rc.receipt_date,
  null::uuid,
  null::uuid,
  rc.id,
  rc.vendor,
  null::numeric,
  null::numeric,
  a.amount
from public.receipts rc
join public.receipt_amounts a on a.receipt_id = rc.id
where rc.status = 'approved'
  and (select public.current_user_role()) in ('owner', 'system_admin');

-- Crew hours on SUBMITTED reports with no rate on their date - never
-- silently zero.
create view public.unpriced_hours
with (security_invoker = true)
as
select
  r.company_id,
  r.project_id,
  p.name              as project_name,
  r.id                as report_id,
  r.report_date,
  'labour'::text      as category,
  c.employee_id,
  emp.full_name       as name,
  c.hours
from public.daily_reports r
join public.projects p on p.id = r.project_id
join public.report_crew c on c.report_id = r.id
join public.employees emp on emp.id = c.employee_id
where r.status = 'submitted'
  and public.rate_on(c.employee_id, r.report_date) is null
  and (select public.current_user_role()) in ('owner', 'system_admin');

-- Each project x every category: budget, spent, remaining, % used, unpriced
-- hours. budget is null when none has been set. (As before.)
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

-- Cost per project per week (weeks start on Monday). (As before.)
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

revoke all on public.project_cost_lines, public.unpriced_hours, public.project_cost_vs_budget,
  public.project_cost_by_week
  from anon, authenticated;
grant select on public.project_cost_lines, public.unpriced_hours, public.project_cost_vs_budget,
  public.project_cost_by_week
  to authenticated;

-- ===========================================================================
-- 10. Dashboard functions without plant. Same rules: SECURITY INVOKER,
--     read-only, owner/admin check (anyone else gets nothing).
-- ===========================================================================

-- Headline numbers. "Missing rates" now counts people only. (Otherwise as before.)
create or replace function public.dashboard_summary(p_project_id uuid, p_from date, p_to date)
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
            count(distinct u.employee_id) as items
       from public.unpriced_hours u
      where (p_project_id is null or u.project_id = p_project_id)
        and u.report_date between p_from and p_to) unpriced
  where public.current_user_role() in ('owner', 'system_admin');
$$;

-- What's waiting. "Missing rates" counts people only. (Otherwise as before.)
create or replace function public.dashboard_action_items()
returns table (pending_receipts bigint, missing_rate_items bigint, unpriced_hours numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    (select count(*) from public.receipts r where r.status = 'submitted'),
    (select count(distinct u.employee_id) from public.unpriced_hours u),
    (select coalesce(sum(u.hours), 0) from public.unpriced_hours u)
  where public.current_user_role() in ('owner', 'system_admin');
$$;

-- Spend per week in the range, split into labour and receipts (VAT
-- inclusive). Every week listed, R0 weeks included.
create function public.dashboard_weekly_mix(p_project_id uuid, p_from date, p_to date)
returns table (week_start date, labour numeric, receipts numeric, total numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    w.week_start,
    coalesce(sum(l.amount) filter (where l.category = 'labour'), 0),
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

revoke execute on function public.dashboard_weekly_mix(uuid, date, date) from public, anon;
grant execute on function public.dashboard_weekly_mix(uuid, date, date) to authenticated;

-- Where the money went in the range: two parts now - labour and receipts -
-- each with its amount and its percentage of the period's total.
create or replace function public.dashboard_mix(p_project_id uuid, p_from date, p_to date)
returns table (source text, label text, sort_order integer, amount numeric, percent numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  with totals as (
    select
      coalesce(sum(l.amount) filter (where l.category = 'labour'), 0)     as labour,
      coalesce(sum(l.amount) filter (where l.receipt_id is not null), 0)  as receipts,
      coalesce(sum(l.amount), 0)                                          as total
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
      ('labour',   'Labour',               1, t.labour),
      ('receipts', 'Receipts (incl. VAT)', 2, t.receipts)
  ) as s (source, label, sort_order, amount)
  where public.current_user_role() in ('owner', 'system_admin')
  order by s.sort_order;
$$;

commit;

-- What was moved and archived (empty steps 1-3 mean there was nothing to move).
select step, item, detail from rework_a_log order by step, detail;
