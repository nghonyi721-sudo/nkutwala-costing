-- Fix: submitting a receipt always said "Upload the photo before submitting."
--
-- Run once in the Supabase SQL Editor of the DEV project
-- (after 20261004120000_receipts.sql).
--
-- Cause: the submit check in receipts_before_update() looked for the photo at
-- NEW.image_path. image_path is a calculated (generated) column, and
-- PostgreSQL doesn't fill those in until AFTER the "before update" trigger has
-- run - so the check compared against an empty value and never found the
-- photo, even when it had uploaded fine.
--
-- Fix: compare against OLD.image_path (the stored value) instead. That is the
-- ONLY change; the function is otherwise identical. No storage rule, table or
-- permission is changed.

begin;

create or replace function public.receipts_before_update()
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
    -- took it can see their own photos - see the storage rules.)
    -- OLD.image_path, not NEW: a calculated column isn't filled in yet in a
    -- BEFORE trigger. The path can't change (id, company and uploader are
    -- locked above), so the stored one is the right one.
    if new.status = 'submitted' and (
         new.image_hash is null
         or not exists (
           select 1 from storage.objects o
           where o.bucket_id = 'receipts'
             and o.name = old.image_path
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

commit;
