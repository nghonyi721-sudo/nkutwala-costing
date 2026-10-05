-- ===========================================================================
-- Undo Rework A (20261006150000_rework_a_remove_equipment.sql)
--
-- The team dropped Rework A. Its migration had already run once on DEV, so
-- this migration puts everything back the way it was before it:
--   - equipment, report_equipment and equipment_rates come back out of the
--     private archive (rows intact), with their original permissions,
--     triggers and functions;
--   - the owned_plant and plant_hire categories come back (from the archive),
--     with the original receipt / employee category rules;
--   - receipts Rework A moved from Plant hire to Other go back; the plant
--     budget lines come back and their amounts leave Other again; employees
--     it changed from Diver to General worker go back to Diver. These are
--     found in the audit log: changed by the database update itself (no
--     logged-in person) and not changed by anyone since;
--   - every function and view Rework A replaced is restored word for word
--     from the migration that originally created it.
-- The archive copies Rework A made (old plant budget lines, the two category
-- rows) are kept as history; the private archive area stays locked.
--
-- All-or-nothing. If Rework A is not in this database it stops straight away
-- and changes nothing. At the end it lists what it restored.
-- ===========================================================================

begin;

do $$
begin
  if to_regclass('archive.equipment') is null or to_regclass('public.equipment') is not null then
    raise exception 'Rework A is not in this database (there is no archived equipment table), so there is nothing to undo. Nothing was changed.';
  end if;
end
$$;

-- What this migration restored; shown at the end.
create temporary table undo_a_log (step text, item text, detail text) on commit preserve rows;

-- ===========================================================================
-- 1. The two plant categories and the original category rules
-- ===========================================================================
insert into public.cost_categories (code, label, sort_order, source)
select c.code, c.label, c.sort_order, c.source
from archive.cost_categories_removed c
where not exists (select 1 from public.cost_categories x where x.code = c.code);

insert into undo_a_log (step, item, detail)
select '1. Category back', c.code, c.label
from archive.cost_categories_removed c;

alter table public.receipts drop constraint receipts_category_check;
alter table public.receipts
  add constraint receipts_category_check
  check (category in ('fuel', 'materials', 'plant_hire', 'consumables', 'food', 'other'));

alter table public.employees drop constraint employees_category_check;
alter table public.employees
  add constraint employees_category_check
  check (category in ('site_manager', 'site_agent', 'diver', 'operator', 'semi_skilled', 'general_worker'));

-- The budget history's link to the category list (Rework A removed it).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.budget_changes'::regclass
      and confrelid = 'public.cost_categories'::regclass
      and contype = 'f'
  ) then
    alter table public.budget_changes
      add constraint budget_changes_category_fkey
      foreign key (category) references public.cost_categories (code);
  end if;
end
$$;

-- ===========================================================================
-- 2. Receipts Rework A moved to Other go back to Plant hire. Submitted
--    receipts are normally locked, so the lock is switched off for this one
--    update only, then back on. The audit log records each change.
-- ===========================================================================
create temporary table undo_a_receipts on commit drop as
select distinct a.entity_id as receipt_id
from public.audit_log a
where a.entity = 'receipts'
  and a.action = 'UPDATE'
  and a.actor is null
  and a.before ->> 'category' = 'plant_hire'
  and a.after ->> 'category' = 'other';

insert into undo_a_log (step, item, detail)
select '2. Receipt back to Plant hire', r.id::text,
       concat(r.receipt_date, ' · ', r.vendor, ' · ', r.status)
from public.receipts r
join undo_a_receipts u on u.receipt_id = r.id
where r.category = 'other';

alter table public.receipts disable trigger receipts_guard_update;
update public.receipts r
set category = 'plant_hire'
from undo_a_receipts u
where r.id = u.receipt_id
  and r.category = 'other';
alter table public.receipts enable trigger receipts_guard_update;

-- ===========================================================================
-- 3. Budgets: the plant lines come back (same ids) and the same amounts come
--    back out of Other. budget_changes and the audit log record each change.
-- ===========================================================================
insert into public.project_budgets (id, company_id, project_id, category, amount)
select b.id, b.company_id, b.project_id, b.category, b.amount
from archive.project_budgets_plant b
where not exists (
  select 1 from public.project_budgets x
  where x.project_id = b.project_id and x.category = b.category
);

insert into undo_a_log (step, item, detail)
select '3. Budget line back (amount taken out of Other)', p.name, concat(b.category, ' · R', b.amount)
from archive.project_budgets_plant b
join public.projects p on p.id = b.project_id;

create temporary table undo_a_plant_totals on commit drop as
select b.project_id, sum(b.amount) as amount
from archive.project_budgets_plant b
group by b.project_id;

do $$
begin
  if exists (
    select 1
    from public.project_budgets pb
    join undo_a_plant_totals t on t.project_id = pb.project_id
    where pb.category = 'other'
      and pb.amount < t.amount
  ) then
    raise exception 'A project''s Other budget is now smaller than the plant amounts Rework A added to it, so they can''t be taken back out safely. Nothing was changed.';
  end if;
end
$$;

update public.project_budgets pb
set amount = pb.amount - t.amount
from undo_a_plant_totals t
where pb.project_id = t.project_id
  and pb.category = 'other';

-- An Other line that Rework A itself created (no Other budget before), which
-- nobody has changed since, is removed again so the project shows "no budget"
-- as before. The audit log keeps a copy.
create temporary table undo_a_created_other on commit drop as
select distinct (i.after ->> 'id')::uuid as budget_id
from public.audit_log i
where i.entity = 'project_budgets'
  and i.action = 'INSERT'
  and i.actor is null
  and i.after ->> 'category' = 'other'
  and exists (
    select 1 from public.audit_log d
    where d.entity = 'project_budgets'
      and d.action = 'DELETE'
      and d.actor is null
      and d.before ->> 'category' in ('owned_plant', 'plant_hire')
      and d.created_at = i.created_at
  )
  and not exists (
    select 1 from public.audit_log later
    where later.entity = 'project_budgets'
      and later.entity_id = (i.after ->> 'id')::uuid
      and later.actor is not null
  );

insert into undo_a_log (step, item, detail)
select '3. Other budget line Rework A created, removed again', p.name, 'no Other budget, as before'
from public.project_budgets pb
join undo_a_created_other c on c.budget_id = pb.id
join public.projects p on p.id = pb.project_id
where pb.amount = 0;

delete from public.project_budgets pb
using undo_a_created_other c
where pb.id = c.budget_id
  and pb.amount = 0;

-- ===========================================================================
-- 4. Employees Rework A changed from Diver to General worker go back.
-- ===========================================================================
create temporary table undo_a_divers on commit drop as
select distinct a.entity_id as employee_id
from public.audit_log a
where a.entity = 'employees'
  and a.action = 'UPDATE'
  and a.actor is null
  and a.before ->> 'category' = 'diver'
  and a.after ->> 'category' = 'general_worker';

insert into undo_a_log (step, item, detail)
select '4. Employee back to Diver', e.id::text, e.full_name
from public.employees e
join undo_a_divers d on d.employee_id = e.id
where e.category = 'general_worker';

update public.employees e
set category = 'diver'
from undo_a_divers d
where e.id = d.employee_id
  and e.category = 'general_worker';

-- ===========================================================================
-- 5. The equipment tables come back out of the archive (rows, rules and
--    indexes intact), with their original permissions.
-- ===========================================================================
alter table archive.equipment set schema public;
alter table archive.report_equipment set schema public;
alter table archive.equipment_rates set schema public;

revoke all on public.equipment from anon, authenticated;
grant select on public.equipment to authenticated;
grant insert (name, ownership, active) on public.equipment to authenticated;
grant update (name, ownership, active) on public.equipment to authenticated;

revoke all on public.report_equipment from anon, authenticated;
grant select, delete on public.report_equipment to authenticated;
grant insert (report_id, equipment_id, hours) on public.report_equipment to authenticated;
grant update (hours) on public.report_equipment to authenticated;

revoke all on public.equipment_rates from anon, authenticated;
grant select on public.equipment_rates to authenticated;
grant insert (equipment_id, hourly_rate, effective_from) on public.equipment_rates to authenticated;
grant update (void_reason) on public.equipment_rates to authenticated;

-- ===========================================================================
-- 6. Functions and triggers, as they were (copied from the original files).
-- ===========================================================================

-- Audit, with its equipment branches (from 20261005120000).
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
  elsif tg_table_name = 'equipment_rates' then
    select q.company_id into v_company
    from public.equipment q
    where q.id = (v_row ->> 'equipment_id')::uuid;
  elsif tg_table_name in ('report_crew', 'report_equipment') then
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

-- Equipment rates: owned equipment only, void-only (from 20261005120000).
create function public.equipment_rates_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.equipment q
    where q.id = new.equipment_id
      and q.ownership = 'own'
  ) then
    raise exception 'Rates can only be added for owned equipment. Rented equipment is costed from its hire receipts.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create function public.equipment_rates_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.voided_at is not null then
    raise exception 'This rate is already voided.';
  end if;

  if new.equipment_id   is distinct from old.equipment_id
  or new.hourly_rate    is distinct from old.hourly_rate
  or new.effective_from is distinct from old.effective_from
  or new.created_at     is distinct from old.created_at then
    raise exception 'Rates cannot be edited. Void the rate and add a new one.' using errcode = '42501';
  end if;

  if length(trim(coalesce(new.void_reason, ''))) = 0 then
    raise exception 'A reason is required to void a rate.' using errcode = '23514';
  end if;

  new.voided_at := now();
  new.voided_by := auth.uid();
  return new;
end;
$$;

create trigger equipment_rates_owned_only
  before insert on public.equipment_rates
  for each row execute function public.equipment_rates_before_insert();

create trigger equipment_rates_void_only
  before update on public.equipment_rates
  for each row execute function public.equipment_rates_before_update();

create trigger audit_equipment_rates
  after insert or update or delete on public.equipment_rates
  for each row execute function public.audit_row_change();

-- Audit triggers on the equipment tables (from 20261004090000).
create trigger audit_equipment
  after insert or update or delete on public.equipment
  for each row execute function public.audit_row_change();

create trigger audit_report_equipment
  after insert or update or delete on public.report_equipment
  for each row execute function public.audit_row_change();

-- Equipment rate look-up (from 20261005120000).
create function public.equipment_rate_on(p_equipment_id uuid, p_date date)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select r.hourly_rate
  from public.equipment_rates r
  where r.equipment_id = p_equipment_id
    and r.effective_from <= p_date
    and r.voided_at is null
    and public.current_user_role() in ('owner', 'system_admin')
  order by r.effective_from desc
  limit 1;
$$;

revoke execute on function public.equipment_rate_on(uuid, date) from public, anon;
grant execute on function public.equipment_rate_on(uuid, date) to authenticated;

-- save_report_draft with its equipment list again (from 20261004090000);
-- Rework A's 2-part version goes.
drop function public.save_report_draft(jsonb, jsonb);

create function public.save_report_draft(p_report jsonb, p_crew jsonb, p_equipment jsonb)
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

revoke execute on function public.save_report_draft(jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.save_report_draft(jsonb, jsonb, jsonb) to authenticated;

-- ===========================================================================
-- 7. The cost views, as they were (from 20261005120000). Rework A's versions
--    go first. Every one: security_invoker = true + the owner/admin check.
-- ===========================================================================
drop view public.project_cost_vs_budget;
drop view public.project_cost_by_week;
drop view public.project_cost_lines;
drop view public.unpriced_hours;

create view public.project_cost_lines
with (security_invoker = true)
as
-- Labour: crew hours on SUBMITTED reports x the rate on that day.
select
  r.company_id,
  r.project_id,
  'labour'::text      as category,
  r.report_date       as cost_date,
  r.id                as report_id,
  c.employee_id,
  null::uuid          as equipment_id,
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
  round(e.hours * rate.hourly_rate, 2)
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
  a.amount
from public.receipts rc
join public.receipt_amounts a on a.receipt_id = rc.id
where rc.status = 'approved'
  and (select public.current_user_role()) in ('owner', 'system_admin');

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
  null::uuid          as equipment_id,
  emp.full_name       as name,
  c.hours
from public.daily_reports r
join public.projects p on p.id = r.project_id
join public.report_crew c on c.report_id = r.id
join public.employees emp on emp.id = c.employee_id
where r.status = 'submitted'
  and public.rate_on(c.employee_id, r.report_date) is null
  and (select public.current_user_role()) in ('owner', 'system_admin')

union all

select
  r.company_id,
  r.project_id,
  p.name,
  r.id,
  r.report_date,
  'owned_plant'::text,
  null::uuid,
  e.equipment_id,
  q.name,
  e.hours
from public.daily_reports r
join public.projects p on p.id = r.project_id
join public.report_equipment e on e.report_id = r.id
join public.equipment q on q.id = e.equipment_id
where r.status = 'submitted'
  and q.ownership = 'own'
  and public.equipment_rate_on(e.equipment_id, r.report_date) is null
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

revoke all on public.project_cost_lines, public.unpriced_hours, public.project_cost_vs_budget,
  public.project_cost_by_week
  from anon, authenticated;
grant select on public.project_cost_lines, public.unpriced_hours, public.project_cost_vs_budget,
  public.project_cost_by_week
  to authenticated;

-- ===========================================================================
-- 8. Dashboard functions, as they were (from 20261006090000 and
--    20261006120000). Their permissions are unchanged, except
--    dashboard_weekly_mix, which is rebuilt (its columns differ).
-- ===========================================================================
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
            count(distinct coalesce(u.employee_id, u.equipment_id)) as items
       from public.unpriced_hours u
      where (p_project_id is null or u.project_id = p_project_id)
        and u.report_date between p_from and p_to) unpriced
  where public.current_user_role() in ('owner', 'system_admin');
$$;

create or replace function public.dashboard_action_items()
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

drop function public.dashboard_weekly_mix(uuid, date, date);

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

revoke execute on function public.dashboard_weekly_mix(uuid, date, date) from public, anon;
grant execute on function public.dashboard_weekly_mix(uuid, date, date) to authenticated;

create or replace function public.dashboard_mix(p_project_id uuid, p_from date, p_to date)
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
-- 9. Summary
-- ===========================================================================
insert into undo_a_log (step, item, detail)
select '5. Back in the app', 'equipment', count(*) || ' machine(s)' from public.equipment
union all
select '5. Back in the app', 'report_equipment', count(*) || ' plant line(s) on daily reports' from public.report_equipment
union all
select '5. Back in the app', 'equipment_rates', count(*) || ' equipment rate(s)' from public.equipment_rates;

commit;

-- What was restored (the SQL Editor shows this as the result).
select step, item, detail from undo_a_log order by step, detail;
