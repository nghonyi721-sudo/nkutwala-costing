-- Phase 3: equipment and the Daily Activity Report. QUANTITIES ONLY - no money.
--
-- Run once in the Supabase SQL Editor of the DEV project
-- (after 20261003160000_companies_projects_employees_rates.sql).
--
-- Rules followed here (see CLAUDE.md):
--   * No money columns in any table in this file.
--   * Reports are never deleted. Crew/equipment lines may be removed only
--     while the report is a draft; the audit log keeps a copy.
--   * One report per manager per project per day.
--   * Site managers see only their own reports; owners/admins see all.
--   * A submitted report is locked until an owner reopens it (with a reason).
--   * Every write is recorded in audit_log.
--
-- Wrapped in a transaction: if anything fails, nothing is applied.

begin;

-- ===========================================================================
-- 1. Audit function: crew/equipment lines have no company_id of their own,
--    so look it up through their report. (IF/ELSIF so each lookup is only
--    prepared when it's actually needed.)
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
-- 2. equipment - NO rate columns
-- ===========================================================================
create table public.equipment (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.current_user_company_id()
             references public.companies (id),
  name       text not null check (length(trim(name)) > 0),
  ownership  text not null check (ownership in ('own', 'rented')),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create index equipment_company_idx on public.equipment (company_id);

create trigger audit_equipment
  after insert or update or delete on public.equipment
  for each row execute function public.audit_row_change();

revoke all on public.equipment from anon, authenticated;
grant select on public.equipment to authenticated;
grant insert (name, ownership, active) on public.equipment to authenticated;
grant update (name, ownership, active) on public.equipment to authenticated;

alter table public.equipment enable row level security;

create policy "Users can read equipment in their company"
  on public.equipment
  for select
  to authenticated
  using (company_id = (select public.current_user_company_id()));

create policy "Owners and system admins can add equipment"
  on public.equipment
  for insert
  to authenticated
  with check (
    (select public.current_user_role()) in ('owner', 'system_admin')
    and company_id = (select public.current_user_company_id())
  );

create policy "Owners and system admins can edit equipment"
  on public.equipment
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
-- 3. daily_reports - quantities only
-- ===========================================================================
create table public.daily_reports (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null default public.current_user_company_id()
                 references public.companies (id),
  project_id     uuid not null references public.projects (id),
  -- The site's local calendar date, chosen on the phone.
  report_date    date not null,
  -- Always the logged-in user: the app is not allowed to send this column.
  reporter_id    uuid not null default auth.uid(),
  start_time     time,
  end_time       time,
  rain_percent   smallint not null default 0 check (rain_percent between 0 and 100),
  delay_hours    numeric(4, 2) not null default 0 check (delay_hours >= 0 and delay_hours <= 24),
  fuel_litres    numeric(10, 2) not null default 0 check (fuel_litres >= 0),
  dsti_done      boolean not null default false,
  internal_audit boolean not null default false,
  near_miss      boolean not null default false,
  safety_moment  boolean not null default false,
  activities     text not null default '',
  status         text not null default 'draft' check (status in ('draft', 'submitted')),
  -- Stamped by the database (guard trigger below), never by the phone.
  submitted_at   timestamptz,
  reopened_at    timestamptz,
  reopened_by    uuid,
  reopen_reason  text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint daily_reports_reporter_id_fkey
    foreign key (reporter_id) references public.profiles (id),
  constraint daily_reports_reopened_by_fkey
    foreign key (reopened_by) references public.profiles (id),
  -- One report per manager per project per day.
  constraint daily_reports_one_per_manager_per_day
    unique (project_id, report_date, reporter_id)
);

create index daily_reports_company_date_idx on public.daily_reports (company_id, report_date desc);
create index daily_reports_reporter_idx on public.daily_reports (reporter_id, report_date desc);

-- Guard: status rules that table permissions alone can't express.
create function public.daily_reports_before_update()
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
        new.activities, new.submitted_at)
       is distinct from
       (old.project_id, old.report_date, old.start_time, old.end_time,
        old.rain_percent, old.delay_hours, old.fuel_litres,
        old.dsti_done, old.internal_audit, old.near_miss, old.safety_moment,
        old.activities, old.submitted_at) then
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

create trigger daily_reports_guard
  before update on public.daily_reports
  for each row execute function public.daily_reports_before_update();

create trigger audit_daily_reports
  after insert or update or delete on public.daily_reports
  for each row execute function public.audit_row_change();

-- Columns the app may fill in / change. NOT reporter_id, company_id or any
-- of the stamps. No delete at all.
revoke all on public.daily_reports from anon, authenticated;
grant select on public.daily_reports to authenticated;
grant insert (
  project_id, report_date, start_time, end_time, rain_percent, delay_hours,
  fuel_litres, dsti_done, internal_audit, near_miss, safety_moment, activities
) on public.daily_reports to authenticated;
grant update (
  project_id, report_date, start_time, end_time, rain_percent, delay_hours,
  fuel_litres, dsti_done, internal_audit, near_miss, safety_moment, activities,
  status, reopen_reason
) on public.daily_reports to authenticated;

alter table public.daily_reports enable row level security;

create policy "Site managers read own reports; owners and admins read all"
  on public.daily_reports
  for select
  to authenticated
  using (
    company_id = (select public.current_user_company_id())
    and (
      reporter_id = (select auth.uid())
      or (select public.current_user_role()) in ('owner', 'system_admin')
    )
  );

create policy "Site managers create their own reports"
  on public.daily_reports
  for insert
  to authenticated
  with check (
    (select public.current_user_role()) = 'site_manager'
    and reporter_id = (select auth.uid())
    and company_id = (select public.current_user_company_id())
    and exists (
      select 1 from public.projects p
      where p.id = project_id
        and p.company_id = (select public.current_user_company_id())
    )
  );

create policy "Site managers edit their own draft reports"
  on public.daily_reports
  for update
  to authenticated
  using (
    (select public.current_user_role()) = 'site_manager'
    and reporter_id = (select auth.uid())
    and status = 'draft'
    and company_id = (select public.current_user_company_id())
  )
  with check (
    reporter_id = (select auth.uid())
    and company_id = (select public.current_user_company_id())
    and exists (
      select 1 from public.projects p
      where p.id = project_id
        and p.company_id = (select public.current_user_company_id())
    )
  );

create policy "Owners and system admins reopen submitted reports"
  on public.daily_reports
  for update
  to authenticated
  using (
    (select public.current_user_role()) in ('owner', 'system_admin')
    and status = 'submitted'
    and company_id = (select public.current_user_company_id())
  )
  with check (
    company_id = (select public.current_user_company_id())
  );

-- ===========================================================================
-- 4. Helper: can the current user change this report's lines?
--    Only the reporter, only while draft. SECURITY INVOKER, so the
--    daily_reports rules above also apply inside it.
-- ===========================================================================
create function public.report_is_editable(p_report_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1 from public.daily_reports r
    where r.id = p_report_id
      and r.reporter_id = auth.uid()
      and r.status = 'draft'
      and r.company_id = public.current_user_company_id()
  );
$$;

revoke execute on function public.report_is_editable(uuid) from public, anon;
grant execute on function public.report_is_editable(uuid) to authenticated;

-- ===========================================================================
-- 5. report_crew and report_equipment - hours only
-- ===========================================================================
create table public.report_crew (
  id          uuid primary key default gen_random_uuid(),
  report_id   uuid not null references public.daily_reports (id),
  employee_id uuid not null references public.employees (id),
  hours       numeric(4, 2) not null check (hours > 0 and hours <= 24),
  created_at  timestamptz not null default now(),
  constraint report_crew_one_line_per_person unique (report_id, employee_id)
);

create table public.report_equipment (
  id           uuid primary key default gen_random_uuid(),
  report_id    uuid not null references public.daily_reports (id),
  equipment_id uuid not null references public.equipment (id),
  hours        numeric(4, 2) not null check (hours > 0 and hours <= 24),
  created_at   timestamptz not null default now(),
  constraint report_equipment_one_line_per_machine unique (report_id, equipment_id)
);

create trigger audit_report_crew
  after insert or update or delete on public.report_crew
  for each row execute function public.audit_row_change();

create trigger audit_report_equipment
  after insert or update or delete on public.report_equipment
  for each row execute function public.audit_row_change();

-- Lines may be added, have their hours changed, or be removed - but only
-- while the report is a draft (policies below). The audit log keeps a copy
-- of every removed line.
revoke all on public.report_crew from anon, authenticated;
grant select, delete on public.report_crew to authenticated;
grant insert (report_id, employee_id, hours) on public.report_crew to authenticated;
grant update (hours) on public.report_crew to authenticated;

revoke all on public.report_equipment from anon, authenticated;
grant select, delete on public.report_equipment to authenticated;
grant insert (report_id, equipment_id, hours) on public.report_equipment to authenticated;
grant update (hours) on public.report_equipment to authenticated;

alter table public.report_crew enable row level security;
alter table public.report_equipment enable row level security;

-- Read a line if you can read its report (the daily_reports rules decide).
create policy "Read crew lines of reports you can read"
  on public.report_crew
  for select
  to authenticated
  using (exists (select 1 from public.daily_reports r where r.id = report_id));

create policy "Reporter adds crew lines to own draft"
  on public.report_crew
  for insert
  to authenticated
  with check (
    public.report_is_editable(report_id)
    and exists (
      select 1 from public.employees e
      where e.id = employee_id
        and e.company_id = (select public.current_user_company_id())
    )
  );

create policy "Reporter changes crew hours on own draft"
  on public.report_crew
  for update
  to authenticated
  using (public.report_is_editable(report_id))
  with check (public.report_is_editable(report_id));

create policy "Reporter removes crew lines from own draft"
  on public.report_crew
  for delete
  to authenticated
  using (public.report_is_editable(report_id));

create policy "Read equipment lines of reports you can read"
  on public.report_equipment
  for select
  to authenticated
  using (exists (select 1 from public.daily_reports r where r.id = report_id));

create policy "Reporter adds equipment lines to own draft"
  on public.report_equipment
  for insert
  to authenticated
  with check (
    public.report_is_editable(report_id)
    and exists (
      select 1 from public.equipment q
      where q.id = equipment_id
        and q.company_id = (select public.current_user_company_id())
    )
  );

create policy "Reporter changes equipment hours on own draft"
  on public.report_equipment
  for update
  to authenticated
  using (public.report_is_editable(report_id))
  with check (public.report_is_editable(report_id));

create policy "Reporter removes equipment lines from own draft"
  on public.report_equipment
  for delete
  to authenticated
  using (public.report_is_editable(report_id));

-- ===========================================================================
-- 6. save_report_draft - saves the report AND its full crew/equipment lists
--    in one all-or-nothing step, so bad signal can't leave a half-saved
--    report. SECURITY INVOKER: runs with the caller's own permissions, so
--    every rule above applies exactly as if the app wrote the tables itself.
--
--    p_report:    { id (null for new), project_id, report_date, start_time,
--                   end_time, rain_percent, delay_hours, fuel_litres,
--                   dsti_done, internal_audit, near_miss, safety_moment,
--                   activities }
--    p_crew:      [ { employee_id, hours }, ... ]   - the complete list
--    p_equipment: [ { equipment_id, hours }, ... ]  - the complete list
--    Returns the report id.
-- ===========================================================================
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

commit;
