-- Phase 2: audit log, companies, projects, employees, dated rates.
--
-- Run once in the Supabase SQL Editor of the DEV project
-- (after 20261003120000 and 20261003140000).
--
-- Rules followed here (see CLAUDE.md):
--   * Rate Wall: employee_rates and audit_log are owner/system_admin only.
--   * Nothing is hard-deleted: no app role can delete anything.
--   * Every write is recorded in audit_log by a database trigger.
--   * Rates are dated and never edited; a wrong rate is voided.
--   * Everything is limited to the user's own company.
--
-- Wrapped in a transaction: if anything fails, nothing is applied.

begin;

-- ===========================================================================
-- 1. audit_log - written ONLY by the trigger below, never by the app
-- ===========================================================================
create table public.audit_log (
  id         bigint generated always as identity primary key,
  company_id uuid,           -- no foreign key: the audit trail must never block a write
  actor      uuid,           -- auth.uid() of the user; null = dashboard / SQL Editor
  action     text not null,  -- INSERT / UPDATE / DELETE
  entity     text not null,  -- table name
  entity_id  uuid,
  before     jsonb,
  after      jsonb,
  created_at timestamptz not null default now()
);

create index audit_log_company_created_idx on public.audit_log (company_id, created_at desc);

comment on table public.audit_log is
  'Every change to audited tables. Filled by audit_row_change(). Owner/system_admin read only.';

create function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row     jsonb := to_jsonb(coalesce(new, old));
  v_company uuid;
begin
  -- IF/ELSIF (not CASE) so the employees lookup is only prepared when an
  -- employee_rates row is audited - employees doesn't exist yet when the
  -- first companies row is audited during this migration.
  if tg_table_name = 'companies' then
    v_company := (v_row ->> 'id')::uuid;
  elsif tg_table_name = 'employee_rates' then
    select e.company_id into v_company
    from public.employees e
    where e.id = (v_row ->> 'employee_id')::uuid;
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

-- Start auditing profiles now, so the company_id change below is recorded.
create trigger audit_profiles
  after insert or update or delete on public.profiles
  for each row execute function public.audit_row_change();

-- ===========================================================================
-- 2. companies
-- ===========================================================================
create table public.companies (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now()
);

create trigger audit_companies
  after insert or update or delete on public.companies
  for each row execute function public.audit_row_change();

insert into public.companies (name) values ('Nkutwala Construction');

-- Every existing profile belongs to Nkutwala, then company_id becomes required.
update public.profiles
set company_id = (select c.id from public.companies c where c.name = 'Nkutwala Construction');

alter table public.profiles
  alter column company_id set not null,
  add constraint profiles_company_id_fkey
    foreign key (company_id) references public.companies (id);

-- New login accounts must now get a company too. v1 has exactly one company.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, role, company_id)
  values (
    new.id,
    coalesce(nullif(trim(new.email), ''), 'New user'),
    'site_manager',
    (select c.id from public.companies c order by c.created_at, c.id limit 1)
  );
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- ===========================================================================
-- 3. Helper: the current user's company (same pattern as current_user_role)
-- ===========================================================================
create function public.current_user_company_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.company_id from public.profiles p where p.id = auth.uid();
$$;

revoke execute on function public.current_user_company_id() from public, anon;
grant execute on function public.current_user_company_id() to authenticated;

-- companies: read your own company only, no writes from the app.
revoke all on public.companies from anon, authenticated;
grant select on public.companies to authenticated;
alter table public.companies enable row level security;

create policy "Users can read their own company"
  on public.companies
  for select
  to authenticated
  using (id = (select public.current_user_company_id()));

-- Tighten slice 1: owners/admins read all profiles IN THEIR COMPANY.
drop policy "Owners and system admins can read all profiles" on public.profiles;

create policy "Owners and system admins can read profiles in their company"
  on public.profiles
  for select
  to authenticated
  using (
    (select public.current_user_role()) in ('owner', 'system_admin')
    and company_id = (select public.current_user_company_id())
  );

-- audit_log: owner/admin read only, own company. No writes from the app.
revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;
alter table public.audit_log enable row level security;

create policy "Owners and system admins can read the audit log"
  on public.audit_log
  for select
  to authenticated
  using (
    (select public.current_user_role()) in ('owner', 'system_admin')
    and company_id = (select public.current_user_company_id())
  );

-- ===========================================================================
-- 4. projects - NO money columns (budgets will live in an owner-only table)
-- ===========================================================================
create table public.projects (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null default public.current_user_company_id()
                  references public.companies (id),
  name            text not null check (length(trim(name)) > 0),
  contract_number text,
  status          text not null default 'active'
                  check (status in ('active', 'on_hold', 'complete')),
  created_at      timestamptz not null default now()
);

create index projects_company_idx on public.projects (company_id);

create trigger audit_projects
  after insert or update or delete on public.projects
  for each row execute function public.audit_row_change();

-- The app may only fill in / change these columns. company_id fills itself in.
revoke all on public.projects from anon, authenticated;
grant select on public.projects to authenticated;
grant insert (name, contract_number, status) on public.projects to authenticated;
grant update (name, contract_number, status) on public.projects to authenticated;

alter table public.projects enable row level security;

create policy "Users can read projects in their company"
  on public.projects
  for select
  to authenticated
  using (company_id = (select public.current_user_company_id()));

create policy "Owners and system admins can add projects"
  on public.projects
  for insert
  to authenticated
  with check (
    (select public.current_user_role()) in ('owner', 'system_admin')
    and company_id = (select public.current_user_company_id())
  );

create policy "Owners and system admins can edit projects"
  on public.projects
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
-- 5. employees - NO money columns. Employees do not log in.
-- ===========================================================================
create table public.employees (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.current_user_company_id()
             references public.companies (id),
  full_name  text not null check (length(trim(full_name)) > 0),
  category   text not null check (category in (
               'site_manager', 'site_agent', 'diver',
               'operator', 'semi_skilled', 'general_worker')),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create index employees_company_idx on public.employees (company_id);

create trigger audit_employees
  after insert or update or delete on public.employees
  for each row execute function public.audit_row_change();

revoke all on public.employees from anon, authenticated;
grant select on public.employees to authenticated;
grant insert (full_name, category, active) on public.employees to authenticated;
grant update (full_name, category, active) on public.employees to authenticated;

alter table public.employees enable row level security;

create policy "Users can read employees in their company"
  on public.employees
  for select
  to authenticated
  using (company_id = (select public.current_user_company_id()));

create policy "Owners and system admins can add employees"
  on public.employees
  for insert
  to authenticated
  with check (
    (select public.current_user_role()) in ('owner', 'system_admin')
    and company_id = (select public.current_user_company_id())
  );

create policy "Owners and system admins can edit employees"
  on public.employees
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
-- 6. employee_rates - MONEY. Owner/system_admin only. Never edited, only voided.
-- ===========================================================================
create table public.employee_rates (
  id             uuid primary key default gen_random_uuid(),
  employee_id    uuid not null references public.employees (id),
  hourly_rate    numeric(10, 2) not null check (hourly_rate > 0),
  effective_from date not null,
  created_at     timestamptz not null default now(),
  voided_at      timestamptz,
  voided_by      uuid references public.profiles (id),
  void_reason    text,
  constraint employee_rates_void_needs_reason
    check (voided_at is null or length(trim(coalesce(void_reason, ''))) > 0)
);

-- One LIVE rate per employee per start date. Voided rates don't count, so a
-- wrong rate can be voided and the correct one entered for the same date.
create unique index employee_rates_one_live_rate
  on public.employee_rates (employee_id, effective_from)
  where voided_at is null;

-- Voiding is the only change ever allowed. The database stamps when and who.
create function public.employee_rates_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.voided_at is not null then
    raise exception 'This rate is already voided.';
  end if;

  if new.employee_id    is distinct from old.employee_id
  or new.hourly_rate    is distinct from old.hourly_rate
  or new.effective_from is distinct from old.effective_from
  or new.created_at     is distinct from old.created_at then
    raise exception 'Rates cannot be edited. Void the rate and add a new one.';
  end if;

  if length(trim(coalesce(new.void_reason, ''))) = 0 then
    raise exception 'A reason is required to void a rate.';
  end if;

  new.voided_at := now();
  new.voided_by := auth.uid();
  return new;
end;
$$;

create trigger employee_rates_void_only
  before update on public.employee_rates
  for each row execute function public.employee_rates_before_update();

create trigger audit_employee_rates
  after insert or update or delete on public.employee_rates
  for each row execute function public.audit_row_change();

-- The app may add a rate, and may only send void_reason when voiding.
revoke all on public.employee_rates from anon, authenticated;
grant select on public.employee_rates to authenticated;
grant insert (employee_id, hourly_rate, effective_from) on public.employee_rates to authenticated;
grant update (void_reason) on public.employee_rates to authenticated;

alter table public.employee_rates enable row level security;

create policy "Owners and system admins can read rates"
  on public.employee_rates
  for select
  to authenticated
  using (
    (select public.current_user_role()) in ('owner', 'system_admin')
    and exists (
      select 1 from public.employees e
      where e.id = employee_id
        and e.company_id = (select public.current_user_company_id())
    )
  );

create policy "Owners and system admins can add rates"
  on public.employee_rates
  for insert
  to authenticated
  with check (
    (select public.current_user_role()) in ('owner', 'system_admin')
    and exists (
      select 1 from public.employees e
      where e.id = employee_id
        and e.company_id = (select public.current_user_company_id())
    )
  );

create policy "Owners and system admins can void rates"
  on public.employee_rates
  for update
  to authenticated
  using (
    voided_at is null
    and (select public.current_user_role()) in ('owner', 'system_admin')
    and exists (
      select 1 from public.employees e
      where e.id = employee_id
        and e.company_id = (select public.current_user_company_id())
    )
  )
  with check (
    (select public.current_user_role()) in ('owner', 'system_admin')
  );

-- ===========================================================================
-- 7. rate_on(employee, date) - the rate that applied on that date.
--    SECURITY INVOKER on purpose: it runs with the CALLER's permissions, so the
--    employee_rates rules above apply. A site manager gets null.
-- ===========================================================================
create function public.rate_on(p_employee_id uuid, p_date date)
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
  order by r.effective_from desc
  limit 1;
$$;

revoke execute on function public.rate_on(uuid, date) from public, anon;
grant execute on function public.rate_on(uuid, date) to authenticated;

commit;
