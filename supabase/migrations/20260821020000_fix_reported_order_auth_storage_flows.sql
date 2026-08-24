-- Repair onboarding uploads, role synchronization, pickup wording and timed driver suspensions.

alter table public.drivers
  add column if not exists suspended_until timestamptz;

-- Every Auth profile is a customer by default. Higher roles retain precedence in get_my_access_role().
insert into public.user_roles (user_id, role)
select p.id, 'user'::public.app_role
from public.profiles p
on conflict (user_id, role) do nothing;

-- Repair legacy/direct driver rows that were created without their Auth relationship.
update public.drivers d
set user_id = u.id
from auth.users u
where d.user_id is null
  and not exists (select 1 from public.drivers linked where linked.user_id = u.id)
  and (
    d.id = u.id
    or (
      regexp_replace(coalesce(d.phone, ''), '\D', '', 'g') <> ''
      and regexp_replace(coalesce(d.phone, ''), '\D', '', 'g') = regexp_replace(coalesce(u.phone, u.raw_user_meta_data->>'phone', ''), '\D', '', 'g')
      and 1 = (
        select count(*)
        from auth.users matching_user
        where regexp_replace(coalesce(matching_user.phone, matching_user.raw_user_meta_data->>'phone', ''), '\D', '', 'g') = regexp_replace(coalesce(d.phone, ''), '\D', '', 'g')
      )
    )
  );

insert into public.user_roles (user_id, role)
select d.user_id, 'driver'::public.app_role
from public.drivers d
where d.user_id is not null
on conflict (user_id, role) do nothing;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (new.id, new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'phone')
  on conflict (id) do nothing;

  insert into public.user_roles (user_id, role)
  values (new.id, 'user'::public.app_role)
  on conflict (user_id, role) do nothing;
  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

create or replace function public.sync_driver_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_id is not null then
    insert into public.user_roles (user_id, role)
    values (new.user_id, 'driver'::public.app_role)
    on conflict (user_id, role) do nothing;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_sync_driver_role on public.drivers;
create trigger trg_sync_driver_role
after insert or update of user_id on public.drivers
for each row execute function public.sync_driver_role();
revoke execute on function public.sync_driver_role() from public, anon, authenticated;

-- Driver documents live below the authenticated user's folder.
drop policy if exists "driver_uploads_insert_own" on storage.objects;
create policy "driver_uploads_insert_own" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'driver-uploads'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "driver_uploads_select" on storage.objects;
create policy "driver_uploads_select" on storage.objects
for select to authenticated
using (
  bucket_id = 'driver-uploads'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or public.is_staff((select auth.uid()))
  )
);

drop policy if exists "driver_uploads_update_own" on storage.objects;
create policy "driver_uploads_update_own" on storage.objects
for update to authenticated
using (bucket_id = 'driver-uploads' and (storage.foldername(name))[1] = (select auth.uid())::text)
with check (bucket_id = 'driver-uploads' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "driver_uploads_delete_own" on storage.objects;
create policy "driver_uploads_delete_own" on storage.objects
for delete to authenticated
using (bucket_id = 'driver-uploads' and (storage.foldername(name))[1] = (select auth.uid())::text);

create or replace function public.online_drivers_count()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.drivers d
  where d.status = 'active'
    and d.approval_status = 'approved'
    and (d.suspended_until is null or d.suspended_until <= now())
    and (
      select count(*)
      from public.deliveries active_delivery
      where active_delivery.driver_id = d.id
        and active_delivery.status not in ('delivered', 'cancelled')
    ) < d.active_order_limit;
$$;
revoke execute on function public.online_drivers_count() from public;
grant execute on function public.online_drivers_count() to anon, authenticated;

create or replace function public.list_available_drivers(_latitude double precision default null, _longitude double precision default null)
returns table(driver_id uuid, user_id uuid, name text, profile_image_url text, phone text, rating numeric, distance_km numeric, status text)
language sql
stable
security definer
set search_path = public
as $$
  select d.id, d.user_id, d.name, d.profile_image_url, d.phone, d.rating,
    case when _latitude is null or _longitude is null or dl.latitude is null or dl.longitude is null then null
      else round((6371 * acos(least(1, greatest(-1,
        cos(radians(_latitude)) * cos(radians(dl.latitude)) * cos(radians(dl.longitude) - radians(_longitude)) + sin(radians(_latitude)) * sin(radians(dl.latitude))
      ))))::numeric, 2) end,
    case when d.status = 'active'
      and (select count(*) from public.deliveries active_delivery where active_delivery.driver_id=d.id and active_delivery.status not in ('delivered','cancelled')) < d.active_order_limit
      then 'online' else 'offline' end
  from public.drivers d
  left join lateral (
    select l.latitude, l.longitude from public.driver_locations l where l.driver_id = d.id order by l.updated_at desc limit 1
  ) dl on true
  where (select auth.uid()) is not null
    and d.approval_status = 'approved'
    and (d.suspended_until is null or d.suspended_until <= now())
  order by 8 desc, 7 nulls last, d.rating desc, d.name;
$$;
revoke all on function public.list_available_drivers(double precision,double precision) from public, anon;
grant execute on function public.list_available_drivers(double precision,double precision) to authenticated;

create or replace function public.suspend_driver_24h(_driver_id uuid, _reason text)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  driver_user_id uuid;
  suspension_end timestamptz := now() + interval '24 hours';
begin
  if not public.has_role((select auth.uid()), 'admin'::public.app_role) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(_reason, '')), '') is null then
    raise exception 'A suspension reason is required';
  end if;

  update public.drivers
  set approval_status = 'suspended', suspended_at = now(), suspended_until = suspension_end,
      suspension_reason = trim(_reason), status = 'offline'
  where id = _driver_id
  returning user_id into driver_user_id;
  if not found then raise exception 'Driver not found' using errcode = 'P0002'; end if;

  if driver_user_id is not null then
    insert into public.notifications(user_id, type, message)
    values (driver_user_id, 'order_update', 'Your driver account has been suspended for 24 hours for violating the Champs delivery Ts and Cs. Reason: ' || trim(_reason));
  end if;
  return suspension_end;
end;
$$;
revoke all on function public.suspend_driver_24h(uuid,text) from public, anon;
grant execute on function public.suspend_driver_24h(uuid,text) to authenticated;

create or replace function public.review_driver_report(_report_id uuid, _status text, _resolution text default null, _driver_action text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare target_driver uuid; driver_user_id uuid;
begin
  if not public.has_role((select auth.uid()),'admin'::public.app_role) then raise exception 'Admin access required' using errcode='42501'; end if;
  if _status not in ('reviewing','resolved','dismissed') then raise exception 'Invalid report status'; end if;
  update public.driver_reports set status=_status,resolution=nullif(trim(coalesce(_resolution,'')),''),reviewed_by=(select auth.uid()),reviewed_at=now() where id=_report_id returning driver_id into target_driver;
  if _driver_action='suspend' then
    update public.drivers set approval_status='suspended',suspended_at=now(),suspended_until=now()+interval '24 hours',suspension_reason=_resolution,status='offline' where id=target_driver returning user_id into driver_user_id;
    if driver_user_id is not null then insert into public.notifications(user_id,type,message) values(driver_user_id,'order_update','Your driver account has been suspended for 24 hours for violating the Champs delivery Ts and Cs. Reason: '||coalesce(nullif(trim(_resolution),''),'Policy violation')); end if;
  elsif _driver_action='expel' then
    update public.drivers set approval_status='rejected',rejected_at=now(),suspended_until=null,suspension_reason=_resolution,status='offline' where id=target_driver returning user_id into driver_user_id;
    if driver_user_id is not null then insert into public.notifications(user_id,type,message) values(driver_user_id,'order_update','Your Champs driver access has been revoked.'); end if;
  end if;
end;
$$;
revoke all on function public.review_driver_report(uuid,text,text,text) from public, anon;
grant execute on function public.review_driver_report(uuid,text,text,text) to authenticated;

create or replace function public.notify_order_workflow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare driver_user uuid; conversation_id uuid; customer_message text; driver_message text;
begin
  if new.driver_id is not null then select user_id into driver_user from public.drivers where id=new.driver_id; end if;

  if new.fulfillment = 'delivery' and new.driver_id is not null and (tg_op='INSERT' or old.driver_id is distinct from new.driver_id) then
    if new.user_id is not null then insert into public.notifications(user_id,type,message,order_id) values(new.user_id,'driver_assigned','A driver has been assigned to order '||new.order_number,new.id); end if;
    if driver_user is not null then insert into public.notifications(user_id,type,message,order_id) values(driver_user,'driver_assigned','New order '||new.order_number||' received',new.id); end if;
  end if;

  if tg_op='UPDATE' and old.workflow_status is distinct from new.workflow_status then
    customer_message := case new.workflow_status
      when 'accepted_by_driver' then 'Driver has accepted your order'
      when 'submitted_to_champs' then 'Your order has been submitted to Champs'
      when 'preparing' then 'Champs is preparing your order'
      when 'ready_for_pickup' then case when new.fulfillment='pickup' then 'Your order is ready for collection' else 'Your order is ready for pickup' end
      when 'picked_up' then 'Your driver has picked up your order'
      when 'out_for_delivery' then 'Your order is out for delivery'
      when 'delivered' then case when new.fulfillment='pickup' then 'Your pickup order has been collected' else 'Your order has been delivered' end
      when 'rejected_by_driver' then 'The driver rejected this order'
      else 'Order status updated: '||replace(new.workflow_status,'_',' ') end;
    if new.user_id is not null then
      insert into public.notifications(user_id,type,message,order_id)
      values(new.user_id,case when new.workflow_status='ready_for_pickup' then 'order_ready' when new.workflow_status='delivered' then 'delivery_complete' else 'order_update' end,customer_message,new.id);
    end if;
    if driver_user is not null and new.workflow_status in ('preparing','ready_for_pickup') then
      driver_message := case new.workflow_status when 'ready_for_pickup' then 'Order '||new.order_number||' is ready for pickup' else 'Champs is preparing order '||new.order_number end;
      insert into public.notifications(user_id,type,message,order_id) values(driver_user,case when new.workflow_status='ready_for_pickup' then 'order_ready' else 'order_update' end,driver_message,new.id);
    end if;
    select id into conversation_id from public.conversations where order_id=new.id and conversation_type='customer_driver';
    if conversation_id is not null and new.user_id is not null then
      insert into public.messages(conversation_id,sender_id,receiver_id,message_text,message_type) values(conversation_id,null,new.user_id,customer_message,'system');
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.notify_order_workflow() from public, anon, authenticated;

