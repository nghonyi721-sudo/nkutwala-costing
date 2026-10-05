-- ===========================================================================
-- Rework C: dashboard drill-down - the line items behind each figure.
--
-- Four read-only functions. Each one:
--   - is SECURITY INVOKER: the caller's own permissions and RLS apply;
--   - checks the caller is owner/system_admin (anyone else gets no rows);
--   - is built on the same views as the dashboard (project_cost_lines,
--     unpriced_hours), so its totals match the dashboard's figures;
--   - sends back the level's totals on every row (total_...), so the app
--     never adds anything up itself.
-- Periods work like the dashboard's: rows whose date is between p_from and
-- p_to (inclusive), for one project or all (p_project_id null).
-- No tables or existing functions change. All-or-nothing.
-- ===========================================================================

begin;

-- ===========================================================================
-- 1. drill_hours: who the Labour or Owned plant cost is for.
--    p_category 'labour'      -> one row per person
--    p_category 'owned_plant' -> one row per owned machine
--    hours = priced + unpriced; days = days worked (Absent days don't count);
--    rates = the hourly rate(s) applied in the period; cost = priced cost.
--    status: the person's status, or active/inactive for a machine.
-- ===========================================================================
create function public.drill_hours(p_project_id uuid, p_from date, p_to date, p_category text)
returns table (
  who_id               uuid,
  name                 text,
  status               text,
  hours                numeric,
  priced_hours         numeric,
  unpriced_hours       numeric,
  days                 bigint,
  rates                numeric[],
  cost                 numeric,
  total_hours          numeric,
  total_unpriced_hours numeric,
  total_cost           numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with lines as (
    select
      coalesce(l.employee_id, l.equipment_id) as who_id,
      l.cost_date                             as day,
      l.hours                                 as priced,
      0::numeric                              as unpriced,
      l.unit_rate,
      l.amount
    from public.project_cost_lines l
    where p_category in ('labour', 'owned_plant')
      and l.category = p_category
      and l.hours > 0
      and l.cost_date between p_from and p_to
      and (p_project_id is null or l.project_id = p_project_id)

    union all

    select
      coalesce(u.employee_id, u.equipment_id),
      u.report_date,
      0::numeric,
      u.hours,
      null::numeric,
      0::numeric
    from public.unpriced_hours u
    where p_category in ('labour', 'owned_plant')
      and u.category = p_category
      and u.report_date between p_from and p_to
      and (p_project_id is null or u.project_id = p_project_id)
  )
  select
    x.who_id,
    coalesce(e.full_name, q.name),
    coalesce(e.status, case when q.active then 'active' else 'inactive' end),
    sum(x.priced) + sum(x.unpriced),
    sum(x.priced),
    sum(x.unpriced),
    count(distinct x.day),
    coalesce(array_agg(distinct x.unit_rate order by x.unit_rate) filter (where x.unit_rate is not null), '{}'),
    sum(x.amount),
    sum(sum(x.priced) + sum(x.unpriced)) over (),
    sum(sum(x.unpriced)) over (),
    sum(sum(x.amount)) over ()
  from lines x
  left join public.employees e on p_category = 'labour' and e.id = x.who_id
  left join public.equipment q on p_category = 'owned_plant' and q.id = x.who_id
  where public.current_user_role() in ('owner', 'system_admin')
  group by x.who_id, e.full_name, e.status, q.name, q.active
  order by sum(x.amount) desc, coalesce(e.full_name, q.name);
$$;

-- ===========================================================================
-- 2. drill_receipts: the APPROVED receipts behind a figure (amounts are the
--    total paid, VAT inclusive, from receipt_amounts via project_cost_lines).
--    p_category: one receipt category, or null for all of them
--    p_vendor:   a vendor as Top vendors shows it, or null. Matched the way
--                Top vendors groups vendors (capitals, spaces and punctuation
--                don't count - the same rule as receipts.vendor_normalised).
--    image_path: where the photo is; the app gets a link that expires after
--                5 minutes (storage's own rules decide).
-- ===========================================================================
create function public.drill_receipts(p_project_id uuid, p_from date, p_to date, p_category text, p_vendor text)
returns table (
  receipt_id     uuid,
  receipt_date   date,
  vendor         text,
  category       text,
  category_label text,
  amount         numeric,
  uploader_name  text,
  project_name   text,
  image_path     text,
  notes          text,
  total_amount   numeric,
  receipt_count  bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    l.receipt_id,
    l.cost_date,
    l.vendor,
    l.category,
    cc.label,
    l.amount,
    up.full_name,
    p.name,
    r.image_path,
    r.notes,
    sum(l.amount) over (),
    count(*) over ()
  from public.project_cost_lines l
  join public.receipts r on r.id = l.receipt_id
  join public.projects p on p.id = l.project_id
  join public.cost_categories cc on cc.code = l.category
  left join public.profiles up on up.id = r.uploader_id
  where l.receipt_id is not null
    and l.cost_date between p_from and p_to
    and (p_project_id is null or l.project_id = p_project_id)
    and (p_category is null or l.category = p_category)
    and (p_vendor is null or r.vendor_normalised = lower(regexp_replace(p_vendor, '[^[:alnum:]]+', '', 'g')))
    and public.current_user_role() in ('owner', 'system_admin')
  order by l.cost_date desc, l.vendor, l.receipt_id;
$$;

-- ===========================================================================
-- 3. drill_unpriced: the hours behind the Unpriced figure - who, which
--    project and day, how many hours - so the owner can set a rate or
--    approve the person. Same rows as the dashboard's unpriced figure.
-- ===========================================================================
create function public.drill_unpriced(p_project_id uuid, p_from date, p_to date)
returns table (
  category        text,
  who_id          uuid,
  name            text,
  employee_status text,
  project_id      uuid,
  project_name    text,
  report_id       uuid,
  report_date     date,
  hours           numeric,
  total_hours     numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    u.category,
    coalesce(u.employee_id, u.equipment_id),
    u.name,
    u.employee_status,
    u.project_id,
    u.project_name,
    u.report_id,
    u.report_date,
    u.hours,
    sum(u.hours) over ()
  from public.unpriced_hours u
  where u.report_date between p_from and p_to
    and (p_project_id is null or u.project_id = p_project_id)
    and public.current_user_role() in ('owner', 'system_admin')
  order by u.name, u.report_date;
$$;

-- ===========================================================================
-- 4. drill_employee_days: one person's days in the period - hours, the
--    project(s), the rate in effect that day, the day's cost, and the
--    reports behind it. Absent (0 h) days are left out. Its totals equal the
--    person's row in drill_hours for the same period.
-- ===========================================================================
create function public.drill_employee_days(p_employee_id uuid, p_project_id uuid, p_from date, p_to date)
returns table (
  day                  date,
  hours                numeric,
  unpriced_hours       numeric,
  projects             text,
  rate                 numeric,
  cost                 numeric,
  reports              jsonb,
  total_hours          numeric,
  total_unpriced_hours numeric,
  total_cost           numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with lines as (
    select l.cost_date as day, l.project_id, l.report_id, l.hours as priced, 0::numeric as unpriced, l.amount
    from public.project_cost_lines l
    where l.category = 'labour'
      and l.employee_id = p_employee_id
      and l.hours > 0
      and l.cost_date between p_from and p_to
      and (p_project_id is null or l.project_id = p_project_id)

    union all

    select u.report_date, u.project_id, u.report_id, 0::numeric, u.hours, 0::numeric
    from public.unpriced_hours u
    where u.category = 'labour'
      and u.employee_id = p_employee_id
      and u.report_date between p_from and p_to
      and (p_project_id is null or u.project_id = p_project_id)
  )
  select
    x.day,
    sum(x.priced) + sum(x.unpriced),
    sum(x.unpriced),
    string_agg(distinct p.name, ', ' order by p.name),
    public.rate_on(p_employee_id, x.day),
    sum(x.amount),
    jsonb_agg(
      jsonb_build_object('report_id', x.report_id, 'project_name', p.name, 'hours', x.priced + x.unpriced)
      order by p.name
    ),
    sum(sum(x.priced) + sum(x.unpriced)) over (),
    sum(sum(x.unpriced)) over (),
    sum(sum(x.amount)) over ()
  from lines x
  join public.projects p on p.id = x.project_id
  where public.current_user_role() in ('owner', 'system_admin')
  group by x.day
  order by x.day;
$$;

-- ===========================================================================
-- 5. Permissions: logged-in users may call them (the check inside decides
--    who gets anything); anonymous visitors may not.
-- ===========================================================================
revoke execute on function
  public.drill_hours(uuid, date, date, text),
  public.drill_receipts(uuid, date, date, text, text),
  public.drill_unpriced(uuid, date, date),
  public.drill_employee_days(uuid, uuid, date, date)
from public, anon;

grant execute on function
  public.drill_hours(uuid, date, date, text),
  public.drill_receipts(uuid, date, date, text, text),
  public.drill_unpriced(uuid, date, date),
  public.drill_employee_days(uuid, uuid, date, date)
to authenticated;

commit;
