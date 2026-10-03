-- Phase 1, slice 1: login and roles
-- Creates the profiles table (one row per login account), the role helper
-- function, row-level security, and a trigger that creates a profile
-- automatically when a user is added in the Supabase dashboard.
--
-- Run once in the Supabase SQL Editor of the DEV project.

-- ---------------------------------------------------------------------------
-- 1. profiles table
-- ---------------------------------------------------------------------------
create table public.profiles (
  -- Same id as the login account. "restrict" blocks deleting a login that
  -- still has a profile: nothing is ever hard-deleted.
  id         uuid primary key references auth.users (id) on delete restrict,
  full_name  text not null check (length(trim(full_name)) > 0),
  role       text not null default 'site_manager'
             check (role in ('system_admin', 'owner', 'site_manager')),
  -- Optional, not linked to any table yet (multi-tenancy is out of scope
  -- for v1). Not used in any security rule.
  company_id uuid,
  created_at timestamptz not null default now()
);

comment on table public.profiles is
  'One row per login account. Role drives all access rules (see the Rate Wall in CLAUDE.md).';

-- ---------------------------------------------------------------------------
-- 2. Table privileges: the app may only READ profiles.
--    Supabase grants everything to anon/authenticated by default, so take it
--    all back and give back SELECT only. Nobody can insert, update or delete
--    profiles from the app - including their own role or company_id.
--    Admins change profiles in the dashboard / SQL Editor instead.
-- ---------------------------------------------------------------------------
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Helper: the current user's role.
--    "security definer" means it runs with the table owner's rights, so it
--    can read profiles without re-triggering the profiles policies (which
--    would otherwise loop forever).
-- ---------------------------------------------------------------------------
create function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.role from public.profiles p where p.id = auth.uid();
$$;

revoke execute on function public.current_user_role() from public, anon;
grant execute on function public.current_user_role() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Row-level security
--    With RLS on, anything without a matching policy is denied. There are
--    deliberately no insert/update/delete policies.
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;

create policy "Users can read their own profile"
  on public.profiles
  for select
  to authenticated
  using (id = (select auth.uid()));

create policy "Owners and system admins can read all profiles"
  on public.profiles
  for select
  to authenticated
  using ((select public.current_user_role()) in ('owner', 'system_admin'));

-- ---------------------------------------------------------------------------
-- 5. Auto-create a profile for every new login account.
--    Starts as site_manager (least access) with the email as a placeholder
--    name. Edit full_name / role afterwards in the Table Editor.
-- ---------------------------------------------------------------------------
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, coalesce(nullif(trim(new.email), ''), 'New user'), 'site_manager');
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
