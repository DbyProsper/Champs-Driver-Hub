alter table public.profiles
  add column if not exists home_address text,
  add column if not exists home_lat double precision,
  add column if not exists home_lng double precision;

alter table public.profiles drop constraint if exists profiles_home_coordinates_check;
alter table public.profiles add constraint profiles_home_coordinates_check check (
  (home_lat is null and home_lng is null)
  or (home_lat between -90 and 90 and home_lng between -180 and 180)
);

alter table public.site_settings
  add column if not exists online_ordering_open boolean not null default true,
  add column if not exists online_ordering_closed_message text not null default 'Online ordering is closed right now. Please check back when Champs reopens.';

alter table public.deliveries
  add column if not exists driver_timeout_notified_at timestamptz;

create index if not exists deliveries_driver_response_deadline_idx
  on public.deliveries(assign_deadline_at)
  where status = 'pending_driver_acceptance' and driver_id is not null;

-- Assignment changes reset the response window and keep the order record in
-- sync. Trigger-only function: direct execution is revoked below.
create or replace function public.sync_order_driver_from_delivery()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    update public.orders set driver_id = null
    where id = old.order_id and driver_id is not null;
    return old;
  end if;

  if tg_op = 'INSERT' or new.driver_id is distinct from old.driver_id then
    new.assign_deadline_at := case when new.driver_id is null then null else now() + interval '10 minutes' end;
    new.broadcast_at := case when new.driver_id is null then null else now() end;
    new.driver_timeout_notified_at := null;
  end if;

  update public.orders
  set driver_id = new.driver_id
  where id = new.order_id and driver_id is distinct from new.driver_id;
  return new;
end;
$$;

drop trigger if exists trg_sync_order_driver_from_delivery on public.deliveries;
create trigger trg_sync_order_driver_from_delivery
before insert or update of driver_id on public.deliveries
for each row execute function public.sync_order_driver_from_delivery();

revoke all on function public.sync_order_driver_from_delivery() from public, anon, authenticated;

update public.deliveries
set assign_deadline_at = coalesce(assign_deadline_at, created_at + interval '10 minutes')
where driver_id is not null and status = 'pending_driver_acceptance';

create or replace function public.notify_expired_driver_assignments()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare affected integer;
begin
  with expired as (
    update public.deliveries d
    set driver_timeout_notified_at = now()
    where d.status = 'pending_driver_acceptance'
      and d.driver_id is not null
      and d.assign_deadline_at <= now()
      and d.driver_timeout_notified_at is null
    returning d.order_id
  ), inserted as (
    insert into public.notifications(user_id,type,message,order_id)
    select o.user_id,'order_update',
      'Your driver has not accepted yet. Choose another available driver, contact the driver, or wait a little longer.',
      o.id
    from expired e join public.orders o on o.id=e.order_id
    where o.user_id is not null
    returning 1
  )
  select count(*) into affected from inserted;
  return affected;
end;
$$;

revoke all on function public.notify_expired_driver_assignments() from public, anon, authenticated;
grant execute on function public.notify_expired_driver_assignments() to service_role;

create extension if not exists pg_cron;
do $$
declare existing_job bigint;
begin
  for existing_job in select jobid from cron.job where jobname='notify-expired-driver-assignments'
  loop
    perform cron.unschedule(existing_job);
  end loop;
  perform cron.schedule(
    'notify-expired-driver-assignments',
    '* * * * *',
    'select public.notify_expired_driver_assignments()'
  );
end $$;

create or replace function public.list_reassignment_drivers(_order_id uuid)
returns table(
  driver_id uuid,
  user_id uuid,
  name text,
  profile_image_url text,
  phone text,
  rating numeric,
  distance_km numeric,
  status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare target public.orders%rowtype;
begin
  select * into target from public.orders where id=_order_id;
  if target.id is null or target.user_id <> (select auth.uid()) then
    raise exception 'Order not found' using errcode='42501';
  end if;
  return query
  select available.*
  from public.list_available_drivers(target.delivery_lat,target.delivery_lng,target.branch_id) available
  where available.status='online'
    and available.driver_id is distinct from target.driver_id
    and not exists (
      select 1 from public.deliveries active
      where active.driver_id=available.driver_id
        and active.order_id<>target.id
        and active.status not in ('delivered','cancelled')
    )
  order by available.distance_km nulls last, available.rating desc, available.name;
end;
$$;

revoke all on function public.list_reassignment_drivers(uuid) from public, anon;
grant execute on function public.list_reassignment_drivers(uuid) to authenticated;

create or replace function public.reassign_timed_out_order(_order_id uuid, _driver_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare target public.orders%rowtype; delivery_row public.deliveries%rowtype;
  next_driver_user uuid; previous_driver_user uuid;
begin
  select * into target from public.orders where id=_order_id for update;
  select * into delivery_row from public.deliveries where order_id=_order_id for update;
  if target.id is null or target.user_id <> (select auth.uid()) then
    raise exception 'Order not found' using errcode='42501';
  end if;
  if delivery_row.status <> 'pending_driver_acceptance' or target.workflow_status <> 'pending_driver_acceptance' then
    raise exception 'This order is no longer waiting for a driver';
  end if;
  if delivery_row.assign_deadline_at is null or delivery_row.assign_deadline_at > now() then
    raise exception 'The selected driver still has time to respond';
  end if;
  if _driver_id = delivery_row.driver_id then raise exception 'Choose a different driver'; end if;
  if not exists (select 1 from public.list_reassignment_drivers(_order_id) x where x.driver_id=_driver_id) then
    raise exception 'That driver is no longer available';
  end if;

  select user_id into previous_driver_user from public.drivers where id=delivery_row.driver_id;
  select user_id into next_driver_user from public.drivers where id=_driver_id;

  update public.conversations
  set conversation_type='customer_driver_archived',updated_at=now()
  where order_id=_order_id and conversation_type='customer_driver';

  update public.deliveries
  set driver_id=_driver_id,status='pending_driver_acceptance',queue_position=null
  where id=delivery_row.id;

  update public.orders
  set driver_id=_driver_id,workflow_status='pending_driver_acceptance',driver_confirmed_at=null,payment_confirmed_at=null
  where id=_order_id;

  if previous_driver_user is not null then
    insert into public.notifications(user_id,type,message,order_id)
    values(previous_driver_user,'order_update','The customer reassigned order '||target.order_number||' to another driver.',_order_id);
  end if;
  insert into public.notifications(user_id,type,message,order_id)
  values(next_driver_user,'driver_assigned','New order '||target.order_number||' is waiting for your response.',_order_id);
  insert into public.notifications(user_id,type,message,order_id)
  values(target.user_id,'driver_assigned','Order '||target.order_number||' was sent to your new driver.',_order_id);
end;
$$;

revoke all on function public.reassign_timed_out_order(uuid,uuid) from public, anon;
grant execute on function public.reassign_timed_out_order(uuid,uuid) to authenticated;

drop policy if exists "Participants send messages" on public.messages;
create policy "Participants send messages"
on public.messages for insert to authenticated
with check (
  sender_id=(select auth.uid())
  and message_type='text'
  and exists (
    select 1 from public.conversations c
    where c.id=messages.conversation_id
      and c.conversation_type<>'customer_driver_archived'
      and messages.sender_id=any(c.participants)
      and messages.receiver_id=any(c.participants)
      and messages.receiver_id<>messages.sender_id
  )
);

drop policy if exists "Signed in customers create orders" on public.orders;
create policy "Signed in customers create orders"
on public.orders for insert to authenticated
with check (
  length(customer_name) between 1 and 100
  and length(customer_phone) between 5 and 20
  and status='pending'::public.order_status
  and subtotal_cents>=0
  and branch_id is not null
  and user_id=(select auth.uid())
  and verified_at is null
  and verified_by is null
  and coalesce((select online_ordering_open from public.site_settings where id='main'),true)
);
