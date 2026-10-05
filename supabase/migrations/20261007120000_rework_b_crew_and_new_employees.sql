-- ===========================================================================
-- Rework B: who works where, and daily hours.
--
--   1. Employees get a status: pending / approved / inactive.
--      - Everyone added starts as PENDING. Site managers may add people
--        (name, category, phone) and fix the pending people THEY added -
--        nothing else. They never approve and never see or send rates.
--      - Only an owner/admin approves, and only once the person has a live
--        hourly rate: approve_employee() saves the rate and approves in one
--        step. Rejecting needs a reason.
--      - "active" becomes automatic (yes unless the status is inactive), so
--        it can never disagree with the status.
--   2. project_employees: who works on which project (the project's team).
--      Owners, admins AND site managers can assign and un-assign. Never
--      deleted - un-assign switches it off. No money anywhere.
--   3. Daily reports: a crew line may have 0 hours (Absent; the row is kept).
--   4. Hours of people who have never been approved are UNPRICED: rate_on()
--      only prices approved people, which covers every cost view, the
--      dashboard and the per-person labour summaries in one place.
--
-- Every new function is SECURITY INVOKER (the caller's own permissions and
-- RLS apply); every view keeps security_invoker = true and the owner/admin
-- check. All-or-nothing.
-- ===========================================================================

begin;

-- ===========================================================================
-- 1. Employees: status, phone, who added them, approval / rejection stamps.
-- ===========================================================================
alter table public.employees
  add column phone         text
    check (phone is null or phone ~ '^[0-9+() -]{6,20}$'),
  add column status        text not null default 'pending'
    check (status in ('pending', 'approved', 'inactive')),
  add column created_by    uuid default auth.uid() references public.profiles (id),
  add column approved_at   timestamptz,
  add column approved_by   uuid references public.profiles (id),
  add column rejected_at   timestamptz,
  add column rejected_by   uuid references public.profiles (id),
  add column reject_reason text,
  add constraint employees_reject_needs_reason
    check (rejected_at is null or length(trim(coalesce(reject_reason, ''))) > 0);

-- Everyone already here was added by an owner: active people are approved,
-- inactive people inactive. All count as approved before, so the hours they
-- have already worked keep their prices.
update public.employees
set status      = case when active then 'approved' else 'inactive' end,
    approved_at = created_at;

-- "active" is now worked out from the status (yes unless inactive). The old
-- on/off value is not lost: it was carried into status just above.
alter table public.employees drop column active;
alter table public.employees
  add column active boolean generated always as (status <> 'inactive') stored;

-- The app may send only these columns. On insert there is no status at all:
-- everyone starts as pending.
revoke insert, update on public.employees from authenticated;
grant insert (full_name, category, phone) on public.employees to authenticated;
grant update (full_name, category, phone, status, reject_reason) on public.employees to authenticated;

-- The rules for every change, whoever sends it.
create function public.employees_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_is_admin boolean := coalesce(public.current_user_role() in ('owner', 'system_admin'), false);
begin
  if tg_op = 'INSERT' then
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

revoke execute on function public.employees_before_write() from public, anon, authenticated;

create trigger employees_rules
  before insert or update on public.employees
  for each row execute function public.employees_before_write();

-- Who may add and edit employees.
drop policy "Owners and system admins can add employees" on public.employees;

create policy "Owners, admins and site managers add pending employees"
  on public.employees
  for insert
  to authenticated
  with check (
    (select public.current_user_role()) in ('owner', 'system_admin', 'site_manager')
    and company_id = (select public.current_user_company_id())
    and status = 'pending'
  );

-- (Owners and admins keep "Owners and system admins can edit employees".)
create policy "Site managers edit pending employees they added"
  on public.employees
  for update
  to authenticated
  using (
    (select public.current_user_role()) = 'site_manager'
    and company_id = (select public.current_user_company_id())
    and status = 'pending'
    and created_by = (select auth.uid())
  )
  with check (
    (select public.current_user_role()) = 'site_manager'
    and company_id = (select public.current_user_company_id())
    and status = 'pending'
    and created_by = (select auth.uid())
  );

-- ===========================================================================
-- 2. project_employees - the team of each project. No money.
-- ===========================================================================
create table public.project_employees (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null default public.current_user_company_id()
              references public.companies (id),
  project_id  uuid not null references public.projects (id),
  employee_id uuid not null references public.employees (id),
  -- Stamped by the database (trigger below), never by the app.
  assigned_by uuid references public.profiles (id),
  assigned_at timestamptz not null default now(),
  active      boolean not null default true,
  constraint project_employees_one_per_person unique (project_id, employee_id)
);

create index project_employees_employee_idx on public.project_employees (employee_id);

create function public.project_employees_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Assigned: stamp who and when.
  if tg_op = 'INSERT' then
    new.assigned_by := auth.uid();
    new.assigned_at := now();
    return new;
  end if;

  if new.project_id  is distinct from old.project_id
  or new.employee_id is distinct from old.employee_id
  or new.company_id  is distinct from old.company_id
  or new.assigned_by is distinct from old.assigned_by
  or new.assigned_at is distinct from old.assigned_at then
    raise exception 'Only whether someone is on the team can be changed.' using errcode = '42501';
  end if;

  -- Put back on the team: stamp who and when again.
  if new.active and not old.active then
    new.assigned_by := auth.uid();
    new.assigned_at := now();
  end if;
  return new;
end;
$$;

revoke execute on function public.project_employees_before_write() from public, anon, authenticated;

create trigger project_employees_stamp
  before insert or update on public.project_employees
  for each row execute function public.project_employees_before_write();

create trigger audit_project_employees
  after insert or update or delete on public.project_employees
  for each row execute function public.audit_row_change();

-- Assign (insert) or switch on/off (update). Never deleted.
revoke all on public.project_employees from anon, authenticated;
grant select on public.project_employees to authenticated;
grant insert (project_id, employee_id) on public.project_employees to authenticated;
grant update (active) on public.project_employees to authenticated;

alter table public.project_employees enable row level security;

create policy "Users can read project teams in their company"
  on public.project_employees
  for select
  to authenticated
  using (company_id = (select public.current_user_company_id()));

create policy "Owners, admins and site managers assign people to projects"
  on public.project_employees
  for insert
  to authenticated
  with check (
    (select public.current_user_role()) in ('owner', 'system_admin', 'site_manager')
    and company_id = (select public.current_user_company_id())
    and exists (
      select 1 from public.projects p
      where p.id = project_id
        and p.company_id = (select public.current_user_company_id())
    )
    and exists (
      select 1 from public.employees e
      where e.id = employee_id
        and e.company_id = (select public.current_user_company_id())
        and e.status <> 'inactive'
    )
  );

create policy "Owners, admins and site managers change project teams"
  on public.project_employees
  for update
  to authenticated
  using (
    (select public.current_user_role()) in ('owner', 'system_admin', 'site_manager')
    and company_id = (select public.current_user_company_id())
  )
  with check (
    (select public.current_user_role()) in ('owner', 'system_admin', 'site_manager')
    and company_id = (select public.current_user_company_id())
  );

-- assign_to_project(project, employee): puts someone on a project's team, or
-- back on it if they were taken off. One step. SECURITY INVOKER: the rules
-- above decide who may (owners, admins, site managers of the same company).
create function public.assign_to_project(p_project_id uuid, p_employee_id uuid)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  insert into public.project_employees as pe (project_id, employee_id)
  values (p_project_id, p_employee_id)
  on conflict (project_id, employee_id) do update
    set active = true
  returning pe.id;
$$;

revoke execute on function public.assign_to_project(uuid, uuid) from public, anon;
grant execute on function public.assign_to_project(uuid, uuid) to authenticated;

-- ===========================================================================
-- 3. Daily reports: 0 hours = Absent (the crew row is kept).
-- ===========================================================================
do $$
declare
  c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.report_crew'::regclass
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) like '%hours%'
  loop
    execute format('alter table public.report_crew drop constraint %I', c.conname);
  end loop;
end
$$;

alter table public.report_crew
  add constraint report_crew_hours_check
  check (hours >= 0 and hours <= 24);

-- ===========================================================================
-- 4. Pending hours are UNPRICED. rate_on() (as in 20261005120000) now also
--    needs the person to have been approved. Every cost view, the dashboard
--    and the labour summaries price hours through rate_on(), so this one
--    change covers them all. Permissions unchanged.
-- ===========================================================================
create or replace function public.rate_on(p_employee_id uuid, p_date date)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select r.hourly_rate
  from public.employee_rates r
  join public.employees e on e.id = r.employee_id
  where r.employee_id = p_employee_id
    and r.effective_from <= p_date
    and r.voided_at is null
    and e.approved_at is not null
    and public.current_user_role() in ('owner', 'system_admin')
  order by r.effective_from desc
  limit 1;
$$;

-- unpriced_hours (as in 20261005120000) leaves out Absent (0 h) lines, and
-- gains one last column: the person's status, so the Missing rates screen
-- can offer "Approve" for pending people.
create or replace view public.unpriced_hours
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
  c.hours,
  emp.status          as employee_status
from public.daily_reports r
join public.projects p on p.id = r.project_id
join public.report_crew c on c.report_id = r.id
join public.employees emp on emp.id = c.employee_id
where r.status = 'submitted'
  and c.hours > 0
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
  e.hours,
  null::text
from public.daily_reports r
join public.projects p on p.id = r.project_id
join public.report_equipment e on e.report_id = r.id
join public.equipment q on q.id = e.equipment_id
where r.status = 'submitted'
  and q.ownership = 'own'
  and public.equipment_rate_on(e.equipment_id, r.report_date) is null
  and (select public.current_user_role()) in ('owner', 'system_admin');

-- ===========================================================================
-- 5. Owner approval.
-- ===========================================================================

-- approve_employee(employee, rate, start date): saves the rate AND approves,
-- all-or-nothing. There is no version without a rate. Owner/admin only (the
-- check is here AND in the rate and employee rules).
create function public.approve_employee(p_employee_id uuid, p_hourly_rate numeric, p_effective_from date)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if coalesce(public.current_user_role() in ('owner', 'system_admin'), false) is false then
    raise exception 'Only the owner can approve employees.' using errcode = '42501';
  end if;

  if p_hourly_rate is null or p_hourly_rate <= 0 or p_effective_from is null then
    raise exception 'An hourly rate and its start date are needed to approve an employee.' using errcode = '23514';
  end if;

  insert into public.employee_rates (employee_id, hourly_rate, effective_from)
  values (p_employee_id, p_hourly_rate, p_effective_from);

  update public.employees
  set status = 'approved'
  where id = p_employee_id
    and status = 'pending';

  if not found then
    raise exception 'This employee is not waiting for approval.' using errcode = '23514';
  end if;
end;
$$;

revoke execute on function public.approve_employee(uuid, numeric, date) from public, anon;
grant execute on function public.approve_employee(uuid, numeric, date) to authenticated;

-- The "New employees" queue: everyone waiting for approval, who added them,
-- and the hours they have already worked. No money. Owner/admin only.
--   hours_logged: on SUBMITTED reports (Absent lines don't count)
--   first_worked: their first report date (any report) - the default start
--                 date for their rate, so the hours already worked get priced
create view public.pending_employees
with (security_invoker = true)
as
select
  e.company_id,
  e.id,
  e.full_name,
  e.category,
  e.phone,
  e.created_at,
  e.created_by,
  adder.full_name                  as added_by_name,
  coalesce(h.hours_logged, 0)      as hours_logged,
  h.first_worked
from public.employees e
left join public.profiles adder on adder.id = e.created_by
left join (
  select
    c.employee_id,
    sum(c.hours) filter (where r.status = 'submitted') as hours_logged,
    min(r.report_date)                                  as first_worked
  from public.report_crew c
  join public.daily_reports r on r.id = c.report_id
  where c.hours > 0
  group by c.employee_id
) h on h.employee_id = e.id
where e.status = 'pending'
  and (select public.current_user_role()) in ('owner', 'system_admin');

revoke all on public.pending_employees from anon, authenticated;
grant select on public.pending_employees to authenticated;

-- employee_duplicates(name): people in the same company with the same name,
-- ignoring capitals and extra spaces - shown as a warning before adding
-- someone new. No money.
create function public.employee_duplicates(p_full_name text)
returns table (id uuid, full_name text, category text, status text)
language sql
stable
security invoker
set search_path = ''
as $$
  select e.id, e.full_name, e.category, e.status
  from public.employees e
  where e.company_id = public.current_user_company_id()
    and lower(regexp_replace(trim(e.full_name), '\s+', ' ', 'g'))
      = lower(regexp_replace(trim(p_full_name), '\s+', ' ', 'g'))
  order by e.full_name;
$$;

revoke execute on function public.employee_duplicates(text) from public, anon;
grant execute on function public.employee_duplicates(text) to authenticated;

commit;

-- What changed (the SQL Editor shows this as the result).
select status, count(*) as employees
from public.employees
group by status
order by status;
