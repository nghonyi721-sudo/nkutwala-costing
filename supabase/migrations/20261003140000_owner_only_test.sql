-- Phase 1, slice 2: owner-only test table
-- A stand-in for future money tables (rates, pay). The attack test script
-- (scripts/rls-attack-test.mjs) checks that a site manager can never read it
-- and that an owner can. Kept permanently as a canary.
--
-- Run once in the Supabase SQL Editor of the DEV project.

create table public.owner_only_test (
  id         uuid primary key default gen_random_uuid(),
  label      text not null,
  dummy_rate numeric(12, 2) not null,
  created_at timestamptz not null default now()
);

comment on table public.owner_only_test is
  'Canary for the Rate Wall. Only owner and system_admin may read it.';

insert into public.owner_only_test (label, dummy_rate)
values ('Dummy rate - must never reach a site manager', 999.99);

-- Read-only for logged-in users; nothing for anonymous visitors.
revoke all on public.owner_only_test from anon, authenticated;
grant select on public.owner_only_test to authenticated;

alter table public.owner_only_test enable row level security;

create policy "Owners and system admins can read owner_only_test"
  on public.owner_only_test
  for select
  to authenticated
  using ((select public.current_user_role()) in ('owner', 'system_admin'));
