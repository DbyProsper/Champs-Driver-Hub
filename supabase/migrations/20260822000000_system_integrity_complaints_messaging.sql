-- System integrity, order-scoped Champs messaging, complaints, ratings visibility,
-- secure tracking, realtime coverage and automatic critical-action auditing.

-- The owner emails have always been treated as admins by get_my_access_role().
-- Persist that role too so database workflows (notably driver/admin chat) agree.
insert into public.user_roles (user_id, role)
select u.id, 'admin'::public.app_role
from auth.users u
where lower(u.email) in ('admin1@champs.co.za', 'admin2@champs.co.za')
  and not exists (
    select 1 from public.user_roles ur
    where ur.user_id = u.id and ur.role = 'admin'::public.app_role
  );

-- Order tracking must never be enumerable by order number.
drop policy if exists "orders public read" on public.orders;
drop policy if exists "Customers read own orders" on public.orders;
create policy "Customers read own orders" on public.orders for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "order_items read" on public.order_items;
drop policy if exists "order_items create" on public.order_items;
drop policy if exists "Customers read own order items" on public.order_items;
create policy "Customers read own order items" on public.order_items for select to authenticated
using (exists (
  select 1 from public.orders o
  where o.id = order_items.order_id and o.user_id = (select auth.uid())
));
drop policy if exists "Customers create own order items" on public.order_items;
create policy "Customers create own order items" on public.order_items for insert to authenticated
with check (
  quantity between 1 and 99 and unit_price_cents >= 0 and length(item_name) between 1 and 200
  and exists (
    select 1 from public.orders o
    where o.id = order_items.order_id and o.user_id = (select auth.uid())
  )
);

drop policy if exists "Customers read own delivery" on public.deliveries;
create policy "Customers read own delivery" on public.deliveries for select to authenticated
using (exists (
  select 1 from public.orders o
  where o.id = deliveries.order_id and o.user_id = (select auth.uid())
));

-- Fix ambiguous self-comparisons in rating/report ownership checks.
drop policy if exists "Customers manage own ratings" on public.driver_ratings;
create policy "Customers manage own ratings" on public.driver_ratings for all to authenticated
using (customer_id = (select auth.uid()))
with check (
  customer_id = (select auth.uid())
  and exists (
    select 1 from public.orders o
    where o.id = driver_ratings.order_id
      and o.user_id = (select auth.uid())
      and o.driver_id = driver_ratings.driver_id
      and o.workflow_status = 'delivered'
  )
);

drop policy if exists "Customers create reports" on public.driver_reports;
create policy "Customers create reports" on public.driver_reports for insert to authenticated
with check (
  customer_id = (select auth.uid())
  and exists (
    select 1 from public.orders o
    where o.id = driver_reports.order_id
      and o.user_id = (select auth.uid())
      and o.driver_id = driver_reports.driver_id
  )
);

-- Safe review feed: exposes no customer identity.
create or replace function public.get_driver_reviews(_driver_id uuid)
returns table(rating smallint, comment text, created_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select r.rating, r.comment, r.created_at
  from public.driver_ratings r
  where r.driver_id = _driver_id
  order by r.created_at desc
  limit 25
$$;
revoke all on function public.get_driver_reviews(uuid) from public;
grant execute on function public.get_driver_reviews(uuid) to anon, authenticated;

-- Driver/Admin conversations can be general or attached to a specific order.
drop index if exists public.conversations_driver_admin_uidx;
create unique index if not exists conversations_driver_admin_general_uidx
  on public.conversations(driver_id)
  where conversation_type = 'driver_admin' and order_id is null;
create unique index if not exists conversations_driver_admin_order_uidx
  on public.conversations(driver_id, order_id)
  where conversation_type = 'driver_admin' and order_id is not null;

drop function if exists public.start_driver_admin_conversation(uuid);
create function public.start_driver_admin_conversation(_driver_id uuid, _order_id uuid default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  driver_user uuid;
  admin_user uuid;
  conversation_id uuid;
begin
  select d.user_id into driver_user from public.drivers d where d.id = _driver_id;
  if driver_user is null then raise exception 'Driver not found'; end if;

  if _order_id is not null and not exists (
    select 1 from public.orders o where o.id = _order_id and o.driver_id = _driver_id
  ) then
    raise exception 'This order is not assigned to the driver' using errcode = '42501';
  end if;

  if (select auth.uid()) = driver_user then
    select ur.user_id into admin_user
    from public.user_roles ur
    where ur.role = 'admin'::public.app_role
    order by ur.created_at limit 1;
  elsif public.is_staff((select auth.uid())) then
    admin_user := (select auth.uid());
  else
    raise exception 'Only this driver or Champs staff can open this chat' using errcode = '42501';
  end if;

  if admin_user is null then raise exception 'No Champs administrator is available'; end if;

  if _order_id is null then
    insert into public.conversations(participants, driver_id, conversation_type)
    values (array[driver_user, admin_user], _driver_id, 'driver_admin')
    on conflict (driver_id) where conversation_type='driver_admin' and order_id is null
    do update set participants=excluded.participants, updated_at=now()
    returning id into conversation_id;
  else
    insert into public.conversations(participants, order_id, driver_id, conversation_type)
    values (array[driver_user, admin_user], _order_id, _driver_id, 'driver_admin')
    on conflict (driver_id, order_id) where conversation_type='driver_admin' and order_id is not null
    do update set participants=excluded.participants, updated_at=now()
    returning id into conversation_id;
  end if;
  return conversation_id;
end
$$;
revoke all on function public.start_driver_admin_conversation(uuid,uuid) from public, anon;
grant execute on function public.start_driver_admin_conversation(uuid,uuid) to authenticated;

-- The PIN is deliberately omitted from driver list queries and released only
-- after that driver has accepted the assigned order.
create or replace function public.get_driver_order_pin(_order_id uuid)
returns text
language sql stable security definer set search_path = ''
as $$
  select o.pickup_pin
  from public.orders o
  join public.drivers d on d.id = o.driver_id
  where o.id = _order_id
    and d.user_id = (select auth.uid())
    and o.workflow_status in ('accepted_by_driver','submitted_to_champs','preparing','ready_for_pickup','picked_up','out_for_delivery','delivered')
$$;
revoke all on function public.get_driver_order_pin(uuid) from public, anon;
grant execute on function public.get_driver_order_pin(uuid) to authenticated;

-- General customer complaints, separate from order-specific driver reports.
create table if not exists public.customer_complaints (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references auth.users(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  driver_id uuid references public.drivers(id) on delete set null,
  category text not null check (category in ('order','driver','payment','service','other')),
  subject text not null check (length(subject) between 3 and 120),
  details text not null check (length(details) between 5 and 4000),
  status text not null default 'open' check (status in ('open','reviewing','resolved','dismissed')),
  resolution text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.customer_complaints enable row level security;
grant select, insert, update on public.customer_complaints to authenticated;
grant all on public.customer_complaints to service_role;
create index if not exists customer_complaints_customer_created_idx on public.customer_complaints(customer_id, created_at desc);
create index if not exists customer_complaints_status_created_idx on public.customer_complaints(status, created_at desc);
create index if not exists customer_complaints_order_idx on public.customer_complaints(order_id) where order_id is not null;
create index if not exists customer_complaints_driver_idx on public.customer_complaints(driver_id) where driver_id is not null;

drop policy if exists "Customers manage own complaints" on public.customer_complaints;
create policy "Customers read own complaints" on public.customer_complaints for select to authenticated
using (customer_id=(select auth.uid()) or public.is_staff((select auth.uid())));
create policy "Customers create own complaints" on public.customer_complaints for insert to authenticated
with check (
  customer_id=(select auth.uid())
  and (order_id is null or exists (
    select 1 from public.orders o where o.id=order_id and o.user_id=(select auth.uid())
  ))
);
create policy "Admins update complaints" on public.customer_complaints for update to authenticated
using (public.is_staff((select auth.uid()))) with check (public.is_staff((select auth.uid())));

create or replace function public.review_customer_complaint(_complaint_id uuid, _status text, _resolution text default null)
returns void language plpgsql security definer set search_path=''
as $$
begin
  if not public.is_staff((select auth.uid())) then raise exception 'Admin access required' using errcode='42501'; end if;
  if _status not in ('reviewing','resolved','dismissed') then raise exception 'Invalid complaint status'; end if;
  update public.customer_complaints
  set status=_status, resolution=nullif(trim(coalesce(_resolution,'')),''), reviewed_by=(select auth.uid()),
      reviewed_at=case when _status in ('resolved','dismissed') then now() else reviewed_at end, updated_at=now()
  where id=_complaint_id;
end $$;
revoke all on function public.review_customer_complaint(uuid,text,text) from public, anon;
grant execute on function public.review_customer_complaint(uuid,text,text) to authenticated;

-- Allow notification kinds introduced by complaints and staff chat.
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in (
  'new_message','order_update','driver_assigned','order_ready','delivery_complete','driver_report','complaint_update','driver_status'
));

create or replace function public.notify_new_complaint()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  insert into public.notifications(user_id,type,message,order_id)
  select distinct ur.user_id, 'driver_report', 'New customer complaint: '||new.subject, new.order_id
  from public.user_roles ur where ur.role='admin'::public.app_role;
  return new;
end $$;
drop trigger if exists trg_notify_new_complaint on public.customer_complaints;
create trigger trg_notify_new_complaint after insert on public.customer_complaints
for each row execute function public.notify_new_complaint();

create or replace function public.notify_complaint_update()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if old.status is distinct from new.status then
    insert into public.notifications(user_id,type,message,order_id)
    values(new.customer_id,'complaint_update','Your complaint is now '||replace(new.status,'_',' '),new.order_id);
  end if;
  return new;
end $$;
drop trigger if exists trg_notify_complaint_update on public.customer_complaints;
create trigger trg_notify_complaint_update after update of status on public.customer_complaints
for each row execute function public.notify_complaint_update();

-- Expand the existing audit trail to all actors and populate it automatically.
alter table public.audit_logs alter column admin_id drop not null;
alter table public.audit_logs add column if not exists actor_role text;
drop policy if exists "Admins can view audit logs" on public.audit_logs;
create policy "Staff can view audit logs" on public.audit_logs for select to authenticated
using (public.is_staff((select auth.uid())));

create or replace function public.audit_critical_change()
returns trigger language plpgsql security definer set search_path=''
as $$
declare
  actor uuid := (select auth.uid());
  target text;
  description text;
  event_type text;
  old_data jsonb := case when tg_op='INSERT' then null else to_jsonb(old) end;
  new_data jsonb := case when tg_op='DELETE' then null else to_jsonb(new) end;
begin
  target := coalesce(new_data->>'id', old_data->>'id');
  event_type := lower(tg_table_name)||'_'||lower(tg_op);
  description := initcap(replace(tg_table_name,'_',' '))||' '||lower(tg_op);
  insert into public.audit_logs(admin_id, actor_role, action_type, action_description, target_type, target_id, metadata)
  values(
    actor,
    coalesce(public.get_my_access_role()::text, case when actor is null then 'system' else 'user' end),
    event_type, description, tg_table_name, target,
    jsonb_build_object(
      'old_status',coalesce(old_data->>'workflow_status',old_data->>'status'),
      'new_status',coalesce(new_data->>'workflow_status',new_data->>'status'),
      'order_id',coalesce(new_data->>'order_id',old_data->>'order_id'),
      'driver_id',coalesce(new_data->>'driver_id',old_data->>'driver_id')
    )
  );
  return coalesce(new,old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['orders','deliveries','drivers','driver_ratings','driver_reports','customer_complaints','delivery_settings'] loop
    execute format('drop trigger if exists trg_audit_critical_change on public.%I',t);
    execute format('create trigger trg_audit_critical_change after insert or update or delete on public.%I for each row execute function public.audit_critical_change()',t);
  end loop;
end $$;

create index if not exists orders_driver_workflow_created_idx on public.orders(driver_id, workflow_status, created_at desc) where driver_id is not null;
create index if not exists orders_user_created_idx on public.orders(user_id, created_at desc) where user_id is not null;
create index if not exists deliveries_status_created_idx on public.deliveries(status, created_at desc);
create index if not exists audit_logs_target_created_idx on public.audit_logs(target_type,target_id,created_at desc);

-- Ensure every screen relying on websocket updates is in the publication.
do $$
declare t text;
begin
  foreach t in array array['customer_complaints','driver_ratings','delivery_settings','driver_reports'] loop
    begin execute format('alter publication supabase_realtime add table public.%I',t);
    exception when duplicate_object then null; end;
  end loop;
end $$;
