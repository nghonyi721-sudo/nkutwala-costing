-- Phase 5: budgets and costing. MONEY - owner/system_admin only, all of it.
--
-- Run once in the Supabase SQL Editor of the DEV project
-- (after 20261005090000_fix_receipt_photo_check.sql).
--
-- Rules followed here (see CLAUDE.md):
--   * Rate Wall: every table, view and function in this file that holds or
--     returns money is owner/system_admin only. Site managers get zero rows
--     or nothing. scripts/rls-attack-test.mjs attacks every object below.
--   * Every view is security_invoker = true: it runs with the permissions of
--     the person asking, so all the row rules on the tables underneath apply.
--     On top of that each view has an explicit owner/admin check.
--   * Receipt amounts are walled off from every app login (Phase 4). The cost
--     views read them through the existing receipt_amounts view - the ONE
--     "runs as its owner" piece, which returns rows only to owners/admins of
--     the same company (see 20261004120000_receipts.sql, section 9).
--   * No double counting:
--       labour       = crew hours on SUBMITTED reports x rate_on()
--       owned_plant  = OWNED equipment hours on SUBMITTED reports x equipment_rate_on()
--       plant_hire, fuel, materials, consumables, food, other
--                    = APPROVED receipts only
--     Fuel litres and rented-equipment hours are quantities only, never priced.
--     Receipt amounts are the total paid, VAT inclusive.
--   * Hours with no rate on their date are never silently zero: they are listed
--     in unpriced_hours and counted next to every project total.
--   * Nothing is deleted. Budgets are changed (and every change is logged);
--     a wrong equipment rate is voided, like employee rates.
--   * Every write is recorded in audit_log.
--
-- Wrapped in a transaction: if anything fails, nothing is applied.

begin;

-- ===========================================================================
-- 1. Audit function: equipment_rates has no company_id of its own, so look
--    it up through the equipment. (Otherwise identical to Phase 3's version.)
-- ===========================================================================
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

-- ===========================================================================
-- 2. cost_categories - THE one category list, for budgets AND costing.
--    Receipts use the six "receipts" ones (their own check already keeps
--    labour and owned_plant out); the foreign key below ties them to this list.
--    No money here: readable by everyone, writable by nobody.
-- ===========================================================================
create table public.cost_categories (
  code       text primary key,
  label      text not null,
  sort_order smallint not null unique,
  source     text not null check (source in ('reports', 'receipts'))
);

insert into public.cost_categories (code, label, sort_order, source) values
  ('labour',      'Labour',      1, 'reports'),
  ('owned_plant', 'Owned plant', 2, 'reports'),
  ('plant_hire',  'Plant hire',  3, 'receipts'),
  ('fuel',        'Fuel',        4, 'receipts'),
  ('materials',   'Materials',   5, 'receipts'),
  ('consumables', 'Consumables', 6, 'receipts'),
  ('food',        'Food',        7, 'receipts'),
  ('other',       'Other',       8, 'receipts');

alter table public.receipts
  add constraint receipts_category_fkey
  foreign key (category) references public.cost_categories (code);

revoke all on public.cost_categories from anon, authenticated;
grant select on public.cost_categories to authenticated;
alter table public.cost_categories enable row level security;

create policy "Everyone can read the cost categories"
  on public.cost_categories
  for select
  to authenticated
  using (true);

-- ===========================================================================
-- 3. project_budgets - MONEY. One amount per project per category.
-- ===========================================================================
create table public.project_budgets (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.current_user_company_id()
             references public.companies (id),
  project_id uuid not null references public.projects (id),
  category   text not null references public.cost_categories (code),
  amount     numeric(14, 2) not null check (amount >= 0),
  -- Stamped by the database (trigger below), never by the app.
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  constraint project_budgets_one_per_category unique (project_id, category)
);

create function public.project_budgets_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (
       new.project_id is distinct from old.project_id
    or new.category   is distinct from old.category
    or new.company_id is distinct from old.company_id) then
    raise exception 'Only the amount of a budget line can be changed.' using errcode = '42501';
  end if;

  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;

create trigger project_budgets_stamp
  before insert or update on public.project_budgets
  for each row execute function public.project_budgets_before_write();

create trigger audit_project_budgets
  after insert or update or delete on public.project_budgets
  for each row execute function public.audit_row_change();

revoke all on public.project_budgets from anon, authenticated;
grant select on public.project_budgets to authenticated;
grant insert (project_id, category, amount) on public.project_budgets to authenticated;
grant update (amount) on public.project_budgets to authenticated;

alter table public.project_budgets enable row level security;

create policy "Owners and system admins read budgets"
  on public.project_budgets
  for select
  to authenticated
  using (
    (select public.current_user_role()) in ('owner', 'system_admin')
    and company_id = (select public.current_user_company_id())
  );

create policy "Owners and system admins add budgets"
  on public.project_budgets
  for insert
  to authenticated
  with check (
    (select public.current_user_role()) in ('owner', 'system_admin')
    and company_id = (select public.current_user_company_id())
    and exists (
      select 1 from public.projects p
      where p.id = project_budgets.project_id
        and p.company_id = (select public.current_user_company_id())
    )
  );

create policy "Owners and system admins change budgets"
  on public.project_budgets
  for update
  to authenticated
  using (
    (select public.current_user_role()) in ('owner', 'system_admin')
    and company_id = (select public.current_user_company_id())
  )
  with check (
    (select public.current_user_role()) in ('owner', 'system_admin')
    and company_id = (select public.current_user_company_id())
  );

-- ===========================================================================
-- 4. budget_changes - every budget change, written ONLY by the trigger below.
--    log_budget_change is SECURITY DEFINER because nobody - not even an
--    owner - may write to this log directly (the app has no insert permission
--    on it). It cannot be called by anyone: it only runs from the trigger.
-- ===========================================================================
create table public.budget_changes (
  id         bigint generated always as identity primary key,
  company_id uuid not null references public.companies (id),
  project_id uuid not null references public.projects (id),
  category   text not null references public.cost_categories (code),
  old_amount numeric(14, 2),          -- null = the first budget for this category
  new_amount numeric(14, 2) not null,
  changed_by uuid references public.profiles (id),
  changed_at timestamptz not null default now()
);

create index budget_changes_project_idx on public.budget_changes (project_id, changed_at desc);

create function public.log_budget_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.amount is distinct from old.amount then
    insert into public.budget_changes
      (company_id, project_id, category, old_amount, new_amount, changed_by)
    values (
      new.company_id,
      new.project_id,
      new.category,
      case when tg_op = 'UPDATE' then old.amount end,
      new.amount,
      auth.uid()
    );
  end if;
  return null;
end;
$$;

revoke execute on function public.log_budget_change() from public, anon, authenticated;

create trigger project_budgets_log_change
  after insert or update on public.project_budgets
  for each row execute function public.log_budget_change();

revoke all on public.budget_changes from anon, authenticated;
grant select on public.budget_changes to authenticated;
alter table public.budget_changes enable row level security;

create policy "Owners and system admins read budget changes"
  on public.budget_changes
  for select
  to authenticated
  using (
    (select public.current_user_role()) in ('owner', 'system_admin')
    and company_id = (select public.current_user_company_id())
  );

-- ===========================================================================
-- 5. equipment_rates - MONEY. OWNED equipment only (rented equipment is
--    costed from its hire receipts). Never edited, only voided - exactly like
--    employee_rates. One LIVE rate per machine per start date.
-- ===========================================================================
create table public.equipment_rates (
  id             uuid primary key default gen_random_uuid(),
  equipment_id   uuid not null references public.equipment (id),
  hourly_rate    numeric(10, 2) not null check (hourly_rate > 0),
  effective_from date not null,
  created_at     timestamptz not null default now(),
  voided_at      timestamptz,
  voided_by      uuid references public.profiles (id),
  void_reason    text,
  constraint equipment_rates_void_needs_reason
    check (voided_at is null or length(trim(coalesce(void_reason, ''))) > 0)
);

create unique index equipment_rates_one_live_rate
  on public.equipment_rates (equipment_id, effective_from)
  where voided_at is null;

-- New rates: only for owned equipment.
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

-- Voiding is the only change ever allowed. The database stamps when and who.
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

revoke all on public.equipment_rates from anon, authenticated;
grant select on public.equipment_rates to authenticated;
grant insert (equipment_id, hourly_rate, effective_from) on public.equipment_rates to authenticated;
grant update (void_reason) on public.equipment_rates to authenticated;

alter table public.equipment_rates enable row level security;

create policy "Owners and system admins read equipment rates"
  on public.equipment_rates
  for select
  to authenticated
  using (
    (select public.current_user_role()) in ('owner', 'system_admin')
    and exists (
      select 1 from public.equipment q
      where q.id = equipment_rates.equipment_id
        and q.company_id = (select public.current_user_company_id())
    )
  );

create policy "Owners and system admins add equipment rates"
  on public.equipment_rates
  for insert
  to authenticated
  with check (
    (select public.current_user_role()) in ('owner', 'system_admin')
    and exists (
      select 1 from public.equipment q
      where q.id = equipment_rates.equipment_id
        and q.company_id = (select public.current_user_company_id())
    )
  );

create policy "Owners and system admins void equipment rates"
  on public.equipment_rates
  for update
  to authenticated
  using (
    voided_at is null
    and (select public.current_user_role()) in ('owner', 'system_admin')
    and exists (
      select 1 from public.equipment q
      where q.id = equipment_rates.equipment_id
        and q.company_id = (select public.current_user_company_id())
    )
  )
  with check (
    (select public.current_user_role()) in ('owner', 'system_admin')
  );

-- ===========================================================================
-- 6. Rate look-ups. SECURITY INVOKER (the rate tables' own rules apply) AND
--    an explicit owner/admin check, so anyone else gets nothing.
-- ===========================================================================
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

-- rate_on (Phase 2) gets the same explicit check. Otherwise unchanged.
create or replace function public.rate_on(p_employee_id uuid, p_date date)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select r.hourly_rate
  from public.employee_rates r
  where r.employee_id = p_employee_id
    and r.effective_from <= p_date
    and r.voided_at is null
    and public.current_user_role() in ('owner', 'system_admin')
  order by r.effective_from desc
  limit 1;
$$;

revoke execute on function public.rate_on(uuid, date) from public, anon;
grant execute on function public.rate_on(uuid, date) to authenticated;

-- ===========================================================================
-- 7. COST VIEWS. Every one: security_invoker = true, plus an explicit
--    owner/admin check, so a site manager gets zero rows - even for the hours
--    on their own reports.
-- ===========================================================================

-- Every priced cost line, one row each. The building block for the others,
-- and the place to check there's no double counting.
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

-- Hours on SUBMITTED reports that have no rate on their date - never
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

-- Each project x every category: budget, spent, remaining, % used, unpriced
-- hours. budget is null when none has been set.
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

-- Cost per project per week (weeks start on Monday).
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

-- Approved receipt spend per vendor and project ("top vendors" = sort by
-- amount). Same vendor typed differently is grouped together.
create view public.vendor_spend
with (security_invoker = true)
as
select
  rc.company_id,
  rc.project_id,
  rc.vendor_normalised    as vendor_key,
  min(rc.vendor)          as vendor,
  count(*)                as receipts,
  sum(a.amount)           as amount,
  max(rc.receipt_date)    as last_receipt_date
from public.receipts rc
join public.receipt_amounts a on a.receipt_id = rc.id
where rc.status = 'approved'
  and (select public.current_user_role()) in ('owner', 'system_admin')
group by rc.company_id, rc.project_id, rc.vendor_normalised;

-- Labour per employee per week, all projects: hours and FLAT-RATE cost.
-- PROVISIONAL - overtime rules are not applied yet.
create view public.labour_provisional_by_employee_week
with (security_invoker = true)
as
select
  r.company_id,
  c.employee_id,
  emp.full_name                                   as employee_name,
  date_trunc('week', r.report_date)::date         as week_start,
  sum(c.hours)                                    as hours,
  sum(c.hours) filter (where rate.hourly_rate is not null) as priced_hours,
  coalesce(round(sum(c.hours * rate.hourly_rate), 2), 0)   as cost,
  coalesce(sum(c.hours) filter (where rate.hourly_rate is null), 0) as unpriced_hours,
  'PROVISIONAL: flat rate x hours, overtime rules not applied'::text as basis
from public.daily_reports r
join public.report_crew c on c.report_id = r.id
join public.employees emp on emp.id = c.employee_id
cross join lateral (select public.rate_on(c.employee_id, r.report_date) as hourly_rate) rate
where r.status = 'submitted'
  and (select public.current_user_role()) in ('owner', 'system_admin')
group by r.company_id, c.employee_id, emp.full_name, date_trunc('week', r.report_date)::date;

-- Views: read-only for logged-in users (the checks inside decide who sees
-- rows); nothing at all for anonymous visitors.
revoke all on public.project_cost_lines, public.unpriced_hours, public.project_cost_vs_budget,
  public.project_cost_by_week, public.vendor_spend, public.labour_provisional_by_employee_week
  from anon, authenticated;
grant select on public.project_cost_lines, public.unpriced_hours, public.project_cost_vs_budget,
  public.project_cost_by_week, public.vendor_spend, public.labour_provisional_by_employee_week
  to authenticated;

commit;
