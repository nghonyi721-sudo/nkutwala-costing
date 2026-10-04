-- Phase 4: receipts. MONEY: the amount column is owner/system_admin only.
--
-- Run once in the Supabase SQL Editor of the DEV project
-- (after 20261004090000_equipment_and_daily_reports.sql).
--
-- Rules followed here (see CLAUDE.md):
--   * Rate Wall: the app's login role cannot read receipts.amount at all.
--     Owners and system admins read amounts through the receipt_amounts view,
--     which returns nothing to anyone else. Not even the person who took the
--     receipt gets the amount back from the server.
--   * Nothing is deleted. An unwanted draft is "discarded"; a wrong receipt is
--     rejected or reversed and a new one captured.
--   * After submitting, a receipt's contents can never change.
--   * Status changes follow fixed rules, enforced here (not just in the app),
--     and every one is written to receipt_status_log.
--   * Photos are private: no public links, own folder only for site managers.
--   * Every write is recorded in audit_log.
--   * Only APPROVED receipts will ever count as cost (Phase 5).
--
-- Wrapped in a transaction: if anything fails, nothing is applied.

begin;

-- ===========================================================================
-- 1. Photo storage: a private bucket, JPEG only, at most 2 MB a photo.
--    Photos live at {company_id}/{uploader_id}/{receipt_id}.jpg
-- ===========================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 2097152, array['image/jpeg'])
on conflict (id) do update
  set public             = false,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ===========================================================================
-- 2. receipts
-- ===========================================================================
create table public.receipts (
  -- The phone may choose the id (so a retry on bad signal can't create a
  -- second copy); the database makes one up if it doesn't.
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null default public.current_user_company_id()
                    references public.companies (id),
  project_id        uuid not null references public.projects (id),
  report_id         uuid references public.daily_reports (id),
  -- Always the logged-in user: the app is not allowed to send this column.
  uploader_id       uuid not null default auth.uid(),
  receipt_date      date not null,
  vendor            text not null
                    check (length(vendor) <= 120 and vendor ~ '[[:alnum:]]'),
  -- For duplicate matching: lower case, no spaces or punctuation.
  -- Calculated by the database, so the phone can't fake it.
  vendor_normalised text generated always as
                    (lower(regexp_replace(vendor, '[^[:alnum:]]+', '', 'g'))) stored,
  category          text not null check (category in (
                      'fuel', 'materials', 'plant_hire', 'consumables', 'food', 'other')),
  -- MONEY, in rands. Nobody can read this column directly (see section 7).
  amount            numeric(12, 2) not null check (amount > 0),
  notes             text not null default '' check (length(notes) <= 1000),
  -- Where the photo lives. Calculated by the database.
  image_path        text generated always as
                    (company_id::text || '/' || uploader_id::text || '/' || id::text || '.jpg') stored,
  -- SHA-256 of the uploaded photo, worked out on the phone. A helper for
  -- spotting the same photo twice - not a security control.
  image_hash        text check (image_hash ~ '^[0-9a-f]{64}$'),
  status            text not null default 'draft' check (status in (
                      'draft', 'submitted', 'approved', 'rejected', 'reversed', 'discarded')),
  -- The approver's "I've checked - not a duplicate" tick.
  duplicate_checked boolean not null default false,
  -- Stamped by the database (guard trigger below), never by the phone.
  reviewed_by       uuid,
  reviewed_at       timestamptz,
  review_reason     text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint receipts_uploader_id_fkey
    foreign key (uploader_id) references public.profiles (id),
  constraint receipts_reviewed_by_fkey
    foreign key (reviewed_by) references public.profiles (id),
  -- Anything past draft must have its photo.
  constraint receipts_photo_before_submit
    check (status in ('draft', 'discarded') or image_hash is not null)
);

create index receipts_company_status_idx on public.receipts (company_id, status, created_at);
create index receipts_uploader_idx on public.receipts (uploader_id, created_at desc);
create index receipts_image_hash_idx on public.receipts (company_id, image_hash);
create index receipts_vendor_amount_idx on public.receipts (company_id, vendor_normalised, amount);

-- ===========================================================================
-- 3. receipt_status_log - every status change, written ONLY by the trigger
--    in section 6. No amounts in here.
-- ===========================================================================
create table public.receipt_status_log (
  id          bigint generated always as identity primary key,
  receipt_id  uuid not null references public.receipts (id),
  from_status text,          -- null = the receipt was just created
  to_status   text not null,
  changed_by  uuid references public.profiles (id),
  reason      text,
  changed_at  timestamptz not null default now()
);

create index receipt_status_log_receipt_idx on public.receipt_status_log (receipt_id, changed_at);

-- ===========================================================================
-- 4. receipt_duplicates(receipt) - other receipts that look like the same
--    spend. NEVER returns amounts.
--
--    A possible duplicate is another receipt in the same company that is
--    submitted, approved or reversed (drafts aren't claims yet and are
--    checked when they're submitted; rejected and discarded never count) with:
--      * the same photo (image_hash), OR
--      * the same vendor (ignoring case and punctuation) + the same amount
--        + a receipt date within 1 day.
--
--    Owners/admins: all matches in the company.
--    Anyone else: only for their OWN receipt, and only matches that are also
--    their own - they never learn anything about other people's receipts.
--
--    SECURITY DEFINER because comparing amounts needs the amount column,
--    which no app user can read. It returns no amounts itself.
-- ===========================================================================
create function public.receipt_duplicates(p_receipt_id uuid)
returns table (
  receipt_id   uuid,
  receipt_date date,
  vendor       text,
  category     text,
  project_id   uuid,
  uploader_id  uuid,
  status       text,
  same_photo   boolean,
  same_details boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    o.id,
    o.receipt_date,
    o.vendor,
    o.category,
    o.project_id,
    o.uploader_id,
    o.status,
    coalesce(o.image_hash = r.image_hash, false),
    (o.vendor_normalised = r.vendor_normalised
      and o.amount = r.amount
      and abs(o.receipt_date - r.receipt_date) <= 1)
  from public.receipts r
  join public.receipts o
    on o.company_id = r.company_id
   and o.id <> r.id
   and o.status in ('submitted', 'approved', 'reversed')
   and (
        o.image_hash = r.image_hash
     or (o.vendor_normalised = r.vendor_normalised
         and o.amount = r.amount
         and abs(o.receipt_date - r.receipt_date) <= 1)
   )
  where r.id = p_receipt_id
    and r.company_id = public.current_user_company_id()
    and (
      public.current_user_role() in ('owner', 'system_admin')
      or (r.uploader_id = auth.uid() and o.uploader_id = auth.uid())
    )
  order by o.created_at;
$$;

revoke execute on function public.receipt_duplicates(uuid) from public, anon;
grant execute on function public.receipt_duplicates(uuid) to authenticated;

-- ===========================================================================
-- 5. Guards: the status rules.
--
--    draft     -> submitted   the person who took it (photo must be uploaded)
--    draft     -> discarded   the person who took it
--    submitted -> approved    owner or system admin, NEVER the person who took
--                             it; a possible duplicate needs the tick first
--    submitted -> rejected    owner or system admin, reason required
--    approved  -> reversed    system admin only, reason required
--    anything else            refused
--
--    Only a draft's contents can change. The review details (who, when) are
--    stamped here. SECURITY INVOKER: it runs as the user making the change.
-- ===========================================================================
create function public.receipts_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status <> 'draft'
  or new.duplicate_checked
  or new.reviewed_by is not null
  or new.reviewed_at is not null
  or new.review_reason is not null then
    raise exception 'A new receipt always starts as a draft.' using errcode = '42501';
  end if;

  -- South African time decides what "today" is.
  if new.receipt_date > (now() at time zone 'Africa/Johannesburg')::date then
    raise exception 'A receipt can''t be dated in the future.' using errcode = '23514';
  end if;

  new.vendor     := trim(new.vendor);
  new.notes      := trim(coalesce(new.notes, ''));
  new.created_at := now();
  new.updated_at := now();
  return new;
end;
$$;

create trigger receipts_guard_insert
  before insert on public.receipts
  for each row execute function public.receipts_before_insert();

create function public.receipts_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_role            text    := public.current_user_role();
  v_content_changed boolean;
begin
  -- These never change after creation.
  if new.id          is distinct from old.id
  or new.company_id  is distinct from old.company_id
  or new.uploader_id is distinct from old.uploader_id
  or new.created_at  is distinct from old.created_at then
    raise exception 'The company, uploader and creation time of a receipt cannot be changed.'
      using errcode = '42501';
  end if;

  if new.reviewed_by is distinct from old.reviewed_by
  or new.reviewed_at is distinct from old.reviewed_at then
    raise exception 'Review details are set by the system.' using errcode = '42501';
  end if;

  v_content_changed :=
    (new.project_id, new.report_id, new.receipt_date, new.vendor,
     new.category, new.amount, new.notes, new.image_hash)
    is distinct from
    (old.project_id, old.report_id, old.receipt_date, old.vendor,
     old.category, old.amount, old.notes, old.image_hash);

  if old.status = 'draft' then
    -- Editing, submitting or discarding a draft: the person who took it only.
    if auth.uid() is distinct from old.uploader_id then
      raise exception 'Only the person who took this receipt can change it.' using errcode = '42501';
    end if;

    if new.status not in ('draft', 'submitted', 'discarded') then
      raise exception 'A draft receipt can only be submitted or discarded.' using errcode = '42501';
    end if;

    if new.duplicate_checked is distinct from old.duplicate_checked
    or new.review_reason     is distinct from old.review_reason then
      raise exception 'Only an approver can do that.' using errcode = '42501';
    end if;

    if new.receipt_date > (now() at time zone 'Africa/Johannesburg')::date then
      raise exception 'A receipt can''t be dated in the future.' using errcode = '23514';
    end if;

    new.vendor := trim(new.vendor);
    new.notes  := trim(coalesce(new.notes, ''));

    -- The photo must really be uploaded before submitting. (The person who
    -- took it can see their own photos - see the storage rules below.)
    if new.status = 'submitted' and (
         new.image_hash is null
         or not exists (
           select 1 from storage.objects o
           where o.bucket_id = 'receipts'
             and o.name = new.image_path
         )
       ) then
      raise exception 'Upload the photo before submitting.' using errcode = '23514';
    end if;

  elsif old.status = 'submitted' then
    if v_role is null or v_role not in ('owner', 'system_admin') then
      raise exception 'Only an owner or system admin can approve or reject a receipt.'
        using errcode = '42501';
    end if;

    if v_content_changed then
      raise exception 'A submitted receipt can''t be changed. Reject it and capture a new one.'
        using errcode = '42501';
    end if;

    if new.status = 'approved' then
      if auth.uid() = old.uploader_id then
        raise exception 'You can''t approve your own receipt.' using errcode = '42501';
      end if;

      -- Called as the approver (owner/admin), so it sees every match.
      if not new.duplicate_checked
         and exists (select 1 from public.receipt_duplicates(old.id)) then
        raise exception 'This receipt may be a duplicate. Tick "I''ve checked - not a duplicate" before approving.'
          using errcode = '23514';
      end if;

    elsif new.status = 'rejected' then
      if length(trim(coalesce(new.review_reason, ''))) = 0 then
        raise exception 'A reason is required to reject a receipt.' using errcode = '23514';
      end if;
      new.duplicate_checked := old.duplicate_checked;

    else
      raise exception 'A submitted receipt can only be approved or rejected.' using errcode = '42501';
    end if;

    new.reviewed_by   := auth.uid();
    new.reviewed_at   := now();
    new.review_reason := nullif(trim(coalesce(new.review_reason, '')), '');

  elsif old.status = 'approved' then
    if new.status is distinct from 'reversed' then
      raise exception 'An approved receipt can only be reversed.' using errcode = '42501';
    end if;

    if v_role is distinct from 'system_admin' then
      raise exception 'Only a system admin can reverse an approved receipt.' using errcode = '42501';
    end if;

    if v_content_changed or new.duplicate_checked is distinct from old.duplicate_checked then
      raise exception 'An approved receipt can''t be changed, only reversed.' using errcode = '42501';
    end if;

    if length(trim(coalesce(new.review_reason, ''))) = 0 then
      raise exception 'A reason is required to reverse a receipt.' using errcode = '23514';
    end if;

    new.reviewed_by   := auth.uid();
    new.reviewed_at   := now();
    new.review_reason := trim(new.review_reason);

  else
    -- rejected, reversed and discarded are final.
    raise exception 'This receipt is % and can no longer be changed.', old.status
      using errcode = '42501';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger receipts_guard_update
  before update on public.receipts
  for each row execute function public.receipts_before_update();

-- ===========================================================================
-- 6. Status log and audit log - written automatically after every change.
-- ===========================================================================
create function public.receipts_log_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.receipt_status_log (receipt_id, from_status, to_status, changed_by)
    values (new.id, null, new.status, auth.uid());
  elsif new.status is distinct from old.status then
    insert into public.receipt_status_log (receipt_id, from_status, to_status, changed_by, reason)
    values (
      new.id,
      old.status,
      new.status,
      auth.uid(),
      case when new.status in ('approved', 'rejected', 'reversed') then new.review_reason end
    );
  end if;
  return null;
end;
$$;

revoke execute on function public.receipts_log_status() from public, anon, authenticated;

create trigger receipts_status_log
  after insert or update on public.receipts
  for each row execute function public.receipts_log_status();

create trigger audit_receipts
  after insert or update or delete on public.receipts
  for each row execute function public.audit_row_change();

-- ===========================================================================
-- 7. Table permissions - THE RATE WALL.
--    The app may read every column EXCEPT amount, so a site manager (or
--    anyone) asking for amount - or for "*" - is refused by the server.
--    It may write amount (typing it in is how it gets there), but never
--    read it back. Owners/admins read amounts via receipt_amounts (section 9).
--    No delete at all.
-- ===========================================================================
revoke all on public.receipts from anon, authenticated;
grant select (
  id, company_id, project_id, report_id, uploader_id, receipt_date, vendor,
  vendor_normalised, category, notes, image_path, image_hash, status,
  duplicate_checked, reviewed_by, reviewed_at, review_reason, created_at, updated_at
) on public.receipts to authenticated;
grant insert (
  id, project_id, report_id, receipt_date, vendor, category, amount, notes, image_hash
) on public.receipts to authenticated;
grant update (
  project_id, report_id, receipt_date, vendor, category, amount, notes, image_hash,
  status, duplicate_checked, review_reason
) on public.receipts to authenticated;

revoke all on public.receipt_status_log from anon, authenticated;
grant select on public.receipt_status_log to authenticated;

-- ===========================================================================
-- 8. Row-level security
-- ===========================================================================
alter table public.receipts enable row level security;
alter table public.receipt_status_log enable row level security;

create policy "Uploaders read own receipts; owners and admins read all"
  on public.receipts
  for select
  to authenticated
  using (
    company_id = (select public.current_user_company_id())
    and (
      uploader_id = (select auth.uid())
      or (select public.current_user_role()) in ('owner', 'system_admin')
    )
  );

create policy "Users add receipts as themselves"
  on public.receipts
  for insert
  to authenticated
  with check (
    uploader_id = (select auth.uid())
    and company_id = (select public.current_user_company_id())
    and status = 'draft'
    and exists (
      select 1 from public.projects p
      where p.id = receipts.project_id
        and p.company_id = (select public.current_user_company_id())
    )
    and (
      receipts.report_id is null
      or exists (
        select 1 from public.daily_reports d
        where d.id = receipts.report_id
          and d.project_id = receipts.project_id
      )
    )
  );

create policy "Uploaders change their own drafts"
  on public.receipts
  for update
  to authenticated
  using (
    uploader_id = (select auth.uid())
    and status = 'draft'
    and company_id = (select public.current_user_company_id())
  )
  with check (
    uploader_id = (select auth.uid())
    and company_id = (select public.current_user_company_id())
    and exists (
      select 1 from public.projects p
      where p.id = receipts.project_id
        and p.company_id = (select public.current_user_company_id())
    )
    and (
      receipts.report_id is null
      or exists (
        select 1 from public.daily_reports d
        where d.id = receipts.report_id
          and d.project_id = receipts.project_id
      )
    )
  );

create policy "Owners and system admins review receipts"
  on public.receipts
  for update
  to authenticated
  using (
    (select public.current_user_role()) in ('owner', 'system_admin')
    and status in ('submitted', 'approved')
    and company_id = (select public.current_user_company_id())
  )
  with check (
    company_id = (select public.current_user_company_id())
  );

-- The log of a receipt is readable by whoever can read the receipt.
create policy "Read the status log of receipts you can read"
  on public.receipt_status_log
  for select
  to authenticated
  using (exists (select 1 from public.receipts r where r.id = receipt_id));

-- ===========================================================================
-- 9. receipt_amounts - the ONLY way the app can read an amount.
--    Owner/system_admin of the same company only; everyone else gets zero
--    rows. It runs with the view owner's rights (that's how it can read the
--    walled-off column), so the role check below is the gate.
--    Supabase's Security Advisor will flag this view as "security definer":
--    that is deliberate here.
-- ===========================================================================
create view public.receipt_amounts
with (security_barrier = true)
as
select r.id as receipt_id, r.amount
from public.receipts r
where (select public.current_user_role()) in ('owner', 'system_admin')
  and r.company_id = (select public.current_user_company_id());

revoke all on public.receipt_amounts from anon, authenticated;
grant select on public.receipt_amounts to authenticated;

-- ===========================================================================
-- 10. Photo rules (storage.objects). No public links: photos are viewed via
--     signed links that expire after 5 minutes (made by the app).
--     No update or delete rules, so nobody can overwrite or delete a photo.
-- ===========================================================================

-- Upload: only to the exact place of your OWN receipt, and only while it's
-- still a draft. That place is in your own folder, so you can't upload into
-- anyone else's.
create policy "Receipt photos: upload for your own draft"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'receipts'
    and exists (
      select 1 from public.receipts r
      where r.image_path = objects.name
        and r.uploader_id = (select auth.uid())
        and r.status = 'draft'
    )
  );

-- View: your own folder; owners and system admins see the whole company.
create policy "Receipt photos: view your own, or all as owner or admin"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = (select public.current_user_company_id())::text
    and (
      (storage.foldername(name))[2] = (select auth.uid())::text
      or (select public.current_user_role()) in ('owner', 'system_admin')
    )
  );

commit;
