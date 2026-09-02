alter table public.driver_applications
  add column if not exists username text;

alter table public.drivers
  add column if not exists username text;

update public.driver_applications
set username = name
where nullif(trim(coalesce(username, '')), '') is null;

update public.drivers
set username = name
where nullif(trim(coalesce(username, '')), '') is null;

alter table public.driver_applications
  alter column username set not null;

alter table public.drivers
  alter column username set not null;

alter table public.driver_applications
  drop constraint if exists driver_applications_username_length_check;
alter table public.driver_applications
  add constraint driver_applications_username_length_check
  check (char_length(trim(username)) between 2 and 40);

alter table public.drivers
  drop constraint if exists drivers_username_length_check;
alter table public.drivers
  add constraint drivers_username_length_check
  check (char_length(trim(username)) between 2 and 40);

create or replace function public.request_driver_application(
  _name text,
  _username text,
  _phone text,
  _id_number text default null,
  _student_number text default null,
  _profile_photo_url text default null,
  _selfie_url text default null,
  _branch_id uuid default null,
  _bank_name text default null,
  _bank_account_number text default null,
  _bank_account_holder text default null
)
returns table(out_application_id uuid, out_status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_application_id uuid;
  saved_status text;
begin
  if auth.uid() is null then
    raise exception 'Sign in before requesting driver access' using errcode = '42501';
  end if;
  if char_length(trim(coalesce(_name, ''))) < 2 then
    raise exception 'Your full legal name is required' using errcode = '23514';
  end if;
  if char_length(trim(coalesce(_username, ''))) not between 2 and 40 then
    raise exception 'Username must be between 2 and 40 characters' using errcode = '23514';
  end if;
  if exists (select 1 from public.drivers d where d.user_id = auth.uid()) then
    raise exception 'Your account already has driver access.' using errcode = '23505';
  end if;

  insert into public.driver_applications (
    user_id, name, username, phone, id_number, student_number,
    profile_photo_url, selfie_url, branch_id, bank_name,
    bank_account_number, bank_account_holder, status
  ) values (
    auth.uid(), trim(_name), trim(_username), trim(_phone),
    nullif(trim(coalesce(_id_number, '')), ''),
    nullif(trim(coalesce(_student_number, '')), ''),
    nullif(trim(coalesce(_profile_photo_url, '')), ''),
    nullif(trim(coalesce(_selfie_url, '')), ''),
    _branch_id,
    nullif(trim(coalesce(_bank_name, '')), ''),
    nullif(trim(coalesce(_bank_account_number, '')), ''),
    nullif(trim(coalesce(_bank_account_holder, '')), ''),
    'pending'
  )
  on conflict (user_id) do update set
    name = excluded.name,
    username = excluded.username,
    phone = excluded.phone,
    id_number = excluded.id_number,
    student_number = excluded.student_number,
    profile_photo_url = excluded.profile_photo_url,
    selfie_url = excluded.selfie_url,
    branch_id = excluded.branch_id,
    bank_name = excluded.bank_name,
    bank_account_number = excluded.bank_account_number,
    bank_account_holder = excluded.bank_account_holder,
    status = case when public.driver_applications.status = 'approved' then 'approved' else 'pending' end,
    admin_notes = null,
    updated_at = now()
  returning public.driver_applications.id, public.driver_applications.status
  into saved_application_id, saved_status;

  return query select saved_application_id, saved_status;
end;
$$;
revoke all on function public.request_driver_application(text,text,text,text,text,text,text,uuid,text,text,text) from public, anon;
grant execute on function public.request_driver_application(text,text,text,text,text,text,text,uuid,text,text,text) to authenticated;

create or replace function public.approve_driver_application(_application_id uuid)
returns table(out_driver_id uuid, out_user_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  app_row public.driver_applications%rowtype;
  saved_driver_id uuid;
begin
  if not private.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'Only admins can approve driver applications' using errcode = '42501';
  end if;

  select * into app_row from public.driver_applications da where da.id = _application_id limit 1;
  if app_row.id is null then
    raise exception 'Driver application not found' using errcode = 'P0002';
  end if;

  insert into public.user_roles (user_id, role)
  values (app_row.user_id, 'driver'::public.app_role)
  on conflict (user_id, role) do nothing;

  insert into public.drivers (
    user_id, name, username, phone, profile_image_url, branch_id,
    bank_name, bank_account_number, bank_account_holder,
    approval_status, approved_at
  ) values (
    app_row.user_id, app_row.name, app_row.username, app_row.phone, app_row.profile_photo_url, app_row.branch_id,
    app_row.bank_name, app_row.bank_account_number, app_row.bank_account_holder,
    'approved', now()
  )
  on conflict (user_id) do update set
    name = excluded.name,
    username = excluded.username,
    phone = excluded.phone,
    profile_image_url = coalesce(public.drivers.profile_image_url, excluded.profile_image_url),
    branch_id = excluded.branch_id,
    bank_name = coalesce(excluded.bank_name, public.drivers.bank_name),
    bank_account_number = coalesce(excluded.bank_account_number, public.drivers.bank_account_number),
    bank_account_holder = coalesce(excluded.bank_account_holder, public.drivers.bank_account_holder),
    approval_status = 'approved',
    approved_at = coalesce(public.drivers.approved_at, now()),
    rejected_at = null,
    suspended_at = null,
    suspension_reason = null,
    updated_at = now()
  returning public.drivers.id into saved_driver_id;

  update public.driver_applications da
  set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), admin_notes = null, updated_at = now()
  where da.id = _application_id;

  return query select saved_driver_id, app_row.user_id;
end;
$$;
revoke all on function public.approve_driver_application(uuid) from public, anon;
grant execute on function public.approve_driver_application(uuid) to authenticated;

create or replace function public.admin_upsert_driver_by_email(
  _email text, _name text, _phone text, _branch_id uuid default null,
  _bank_name text default null, _bank_account_number text default null,
  _bank_account_holder text default null
)
returns table(out_driver_id uuid, out_user_id uuid, out_email text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_user_id uuid;
  target_email text;
  saved_driver_id uuid;
begin
  if not private.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'Only admins can add drivers' using errcode = '42501';
  end if;

  select au.id, lower(au.email) into target_user_id, target_email
  from auth.users au
  where lower(au.email) = lower(trim(_email))
  order by au.created_at desc limit 1;
  if target_user_id is null then
    raise exception 'No account exists for that email yet. Ask them to sign up first, then add them as a driver.' using errcode = 'P0002';
  end if;

  insert into public.user_roles (user_id, role)
  values (target_user_id, 'driver'::public.app_role)
  on conflict (user_id, role) do nothing;

  insert into public.drivers (
    user_id, name, username, phone, branch_id, bank_name,
    bank_account_number, bank_account_holder, approval_status, approved_at
  ) values (
    target_user_id, trim(_name), trim(_name), trim(_phone), _branch_id,
    nullif(trim(coalesce(_bank_name, '')), ''),
    nullif(trim(coalesce(_bank_account_number, '')), ''),
    nullif(trim(coalesce(_bank_account_holder, '')), ''),
    'approved', now()
  )
  on conflict (user_id) do update set
    name = excluded.name,
    username = coalesce(nullif(trim(public.drivers.username), ''), excluded.username),
    phone = excluded.phone,
    branch_id = excluded.branch_id,
    bank_name = coalesce(excluded.bank_name, public.drivers.bank_name),
    bank_account_number = coalesce(excluded.bank_account_number, public.drivers.bank_account_number),
    bank_account_holder = coalesce(excluded.bank_account_holder, public.drivers.bank_account_holder),
    approval_status = coalesce(public.drivers.approval_status, 'approved'),
    approved_at = coalesce(public.drivers.approved_at, now()),
    rejected_at = null,
    suspended_at = null,
    suspension_reason = null,
    updated_at = now()
  returning public.drivers.id into saved_driver_id;

  update public.driver_applications da
  set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
  where da.user_id = target_user_id;

  return query select saved_driver_id, target_user_id, target_email;
end;
$$;
revoke all on function public.admin_upsert_driver_by_email(text,text,text,uuid,text,text,text) from public, anon;
grant execute on function public.admin_upsert_driver_by_email(text,text,text,uuid,text,text,text) to authenticated;

create or replace function public.list_available_drivers(
  _latitude double precision default null,
  _longitude double precision default null,
  _branch_id uuid default null
)
returns table(driver_id uuid, user_id uuid, name text, profile_image_url text, phone text, rating numeric, distance_km numeric, status text)
language sql
stable
security definer
set search_path = ''
as $$
  with candidates as (
    select d.*, dl.latitude as live_latitude, dl.longitude as live_longitude,
      case when _latitude is null or _longitude is null or dl.latitude is null or dl.longitude is null then null
        else round((6371 * acos(least(1, greatest(-1,
          cos(radians(_latitude)) * cos(radians(dl.latitude)) * cos(radians(dl.longitude) - radians(_longitude)) + sin(radians(_latitude)) * sin(radians(dl.latitude))
        ))))::numeric, 2) end as live_distance
    from public.drivers d
    left join lateral (
      select l.latitude,l.longitude from public.driver_locations l where l.driver_id=d.id order by l.updated_at desc limit 1
    ) dl on true
    where d.user_id is not null and d.approval_status='approved'
      and (d.suspended_until is null or d.suspended_until <= now())
      and _branch_id is not null and d.branch_id=_branch_id
  )
  select c.id,c.user_id,coalesce(nullif(trim(c.username), ''), c.name),c.profile_image_url,c.phone,c.rating,c.live_distance,
    case when c.status='active' and (select count(*) from public.deliveries x where x.driver_id=c.id and x.status not in ('delivered','cancelled')) < c.active_order_limit then 'online' else 'offline' end
  from candidates c
  where c.live_distance is null or c.live_distance <= 6
  order by 8 desc,7 nulls last,c.rating desc,coalesce(nullif(trim(c.username), ''), c.name);
$$;
revoke all on function public.list_available_drivers(double precision,double precision,uuid) from public, anon;
grant execute on function public.list_available_drivers(double precision,double precision,uuid) to authenticated;
