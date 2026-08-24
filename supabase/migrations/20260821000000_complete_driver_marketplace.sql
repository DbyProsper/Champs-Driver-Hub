-- Complete driver-mediated ordering, chat, notifications, ratings and reports.
-- The existing UI/status columns remain intact; workflow_status carries the expanded lifecycle.

alter table public.orders
  add column if not exists workflow_status text not null default 'pending',
  add column if not exists driver_confirmed_at timestamptz,
  add column if not exists payment_confirmed_at timestamptz,
  add column if not exists submitted_to_champs_at timestamptz;

alter table public.orders drop constraint if exists orders_workflow_status_check;
alter table public.orders add constraint orders_workflow_status_check check (workflow_status in (
  'pending','pickup_pending','pending_driver_acceptance','accepted_by_driver','rejected_by_driver',
  'submitted_to_champs','preparing','ready_for_pickup','picked_up','out_for_delivery','delivered','cancelled'
));

alter table public.drivers
  add column if not exists profile_image_url text,
  add column if not exists rating numeric(3,2) not null default 0,
  add column if not exists rating_count integer not null default 0;

alter table public.delivery_settings
  add column if not exists pickup_enabled boolean not null default true;

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  participants uuid[] not null,
  order_id uuid references public.orders(id) on delete cascade,
  driver_id uuid references public.drivers(id) on delete cascade,
  conversation_type text not null check (conversation_type in ('customer_driver','driver_admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cardinality(participants) = 2 and participants[1] <> participants[2])
);
create unique index if not exists conversations_order_customer_driver_uidx
  on public.conversations(order_id) where conversation_type = 'customer_driver';
create unique index if not exists conversations_driver_admin_uidx
  on public.conversations(driver_id) where conversation_type = 'driver_admin';
create index if not exists conversations_participants_gin on public.conversations using gin(participants);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid references auth.users(id) on delete set null,
  receiver_id uuid not null references auth.users(id) on delete cascade,
  message_text text not null check (length(trim(message_text)) between 1 and 4000),
  message_type text not null default 'text' check (message_type in ('text','system')),
  read_status boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists messages_conversation_created_idx on public.messages(conversation_id, created_at);
create index if not exists messages_receiver_unread_idx on public.messages(receiver_id, created_at desc) where read_status = false;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('new_message','order_update','driver_assigned','order_ready','delivery_complete','driver_report')),
  message text not null,
  order_id uuid references public.orders(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete cascade,
  read_status boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_unread_idx on public.notifications(user_id, created_at desc) where read_status = false;

create table if not exists public.driver_ratings (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete cascade,
  driver_id uuid not null references public.drivers(id) on delete cascade,
  customer_id uuid not null references auth.users(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  comment text check (comment is null or length(comment) <= 1000),
  created_at timestamptz not null default now()
);
create index if not exists driver_ratings_driver_idx on public.driver_ratings(driver_id, created_at desc);

create table if not exists public.driver_reports (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  driver_id uuid not null references public.drivers(id) on delete cascade,
  customer_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (length(trim(reason)) between 3 and 100),
  details text not null check (length(trim(details)) between 5 and 2000),
  status text not null default 'open' check (status in ('open','reviewing','resolved','dismissed')),
  resolution text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists driver_reports_order_customer_uidx on public.driver_reports(order_id, customer_id);
create index if not exists driver_reports_status_idx on public.driver_reports(status, created_at desc);

create table if not exists public.receipt_print_jobs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  requested_by uuid references auth.users(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','printed','failed')),
  printed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists receipt_print_jobs_pending_idx on public.receipt_print_jobs(created_at) where status = 'pending';

grant select, insert, update on public.conversations, public.messages, public.notifications, public.driver_ratings, public.driver_reports, public.receipt_print_jobs to authenticated;
grant all on public.conversations, public.messages, public.notifications, public.driver_ratings, public.driver_reports, public.receipt_print_jobs to service_role;

alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.notifications enable row level security;
alter table public.driver_ratings enable row level security;
alter table public.driver_reports enable row level security;
alter table public.receipt_print_jobs enable row level security;

drop policy if exists "Participants read conversations" on public.conversations;
create policy "Participants read conversations" on public.conversations for select to authenticated
  using ((select auth.uid()) = any(participants));

drop policy if exists "Participants read messages" on public.messages;
create policy "Participants read messages" on public.messages for select to authenticated
  using (exists (select 1 from public.conversations c where c.id = conversation_id and (select auth.uid()) = any(c.participants)));
drop policy if exists "Participants send messages" on public.messages;
create policy "Participants send messages" on public.messages for insert to authenticated
  with check (
    sender_id = (select auth.uid()) and message_type = 'text' and
    exists (select 1 from public.conversations c where c.id = conversation_id and sender_id = any(c.participants) and receiver_id = any(c.participants) and receiver_id <> sender_id)
  );
drop policy if exists "Recipients mark messages read" on public.messages;
create policy "Recipients mark messages read" on public.messages for update to authenticated
  using (receiver_id = (select auth.uid())) with check (receiver_id = (select auth.uid()));

drop policy if exists "Users read own notifications" on public.notifications;
create policy "Users read own notifications" on public.notifications for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "Users mark own notifications read" on public.notifications;
create policy "Users mark own notifications read" on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "Customers manage own ratings" on public.driver_ratings;
create policy "Customers manage own ratings" on public.driver_ratings for all to authenticated
  using (customer_id = (select auth.uid())) with check (
    customer_id = (select auth.uid()) and exists (
      select 1 from public.orders o where o.id = order_id and o.user_id = (select auth.uid())
        and o.driver_id = driver_id and o.workflow_status = 'delivered'
    )
  );
drop policy if exists "Staff read ratings" on public.driver_ratings;
create policy "Staff read ratings" on public.driver_ratings for select to authenticated using (public.is_staff((select auth.uid())));

drop policy if exists "Customers create and read reports" on public.driver_reports;
create policy "Customers create and read reports" on public.driver_reports for select to authenticated
  using (customer_id = (select auth.uid()) or public.is_staff((select auth.uid())));
create policy "Customers create reports" on public.driver_reports for insert to authenticated
  with check (customer_id = (select auth.uid()) and exists (
    select 1 from public.orders o where o.id = order_id and o.user_id = (select auth.uid()) and o.driver_id = driver_id
  ));
create policy "Admins update reports" on public.driver_reports for update to authenticated
  using (public.has_role((select auth.uid()), 'admin'::public.app_role))
  with check (public.has_role((select auth.uid()), 'admin'::public.app_role));

drop policy if exists "Staff manage receipt jobs" on public.receipt_print_jobs;
create policy "Staff manage receipt jobs" on public.receipt_print_jobs for all to authenticated
  using (public.is_staff((select auth.uid()))) with check (public.is_staff((select auth.uid())));

create or replace function public.list_available_drivers(_latitude double precision default null, _longitude double precision default null)
returns table(driver_id uuid, user_id uuid, name text, profile_image_url text, phone text, rating numeric, distance_km numeric, status text)
language sql stable security definer set search_path = public
as $$
  select d.id, d.user_id, d.name, d.profile_image_url, d.phone, d.rating,
    case when _latitude is null or _longitude is null or dl.latitude is null or dl.longitude is null then null
      else round((6371 * acos(least(1, greatest(-1,
        cos(radians(_latitude)) * cos(radians(dl.latitude)) * cos(radians(dl.longitude) - radians(_longitude)) + sin(radians(_latitude)) * sin(radians(dl.latitude))
      ))))::numeric, 2) end,
    case when d.status = 'active' then 'online' else 'offline' end
  from public.drivers d
  left join lateral (
    select l.latitude, l.longitude from public.driver_locations l where l.driver_id = d.id order by l.updated_at desc limit 1
  ) dl on true
  where (select auth.uid()) is not null and d.approval_status = 'approved' and d.suspended_at is null
  order by (d.status = 'active') desc, 7 nulls last, d.rating desc, d.name;
$$;
revoke all on function public.list_available_drivers(double precision,double precision) from public, anon;
grant execute on function public.list_available_drivers(double precision,double precision) to authenticated;

create or replace function public.start_order_conversation(_order_id uuid)
returns uuid language plpgsql security definer set search_path = public
as $$
declare o public.orders%rowtype; driver_user uuid; created_conversation_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'Sign in to chat' using errcode='42501'; end if;
  select * into o from public.orders where id = _order_id;
  select user_id into driver_user from public.drivers where id = o.driver_id;
  if o.id is null or o.driver_id is null or driver_user is null then raise exception 'This order has no assigned driver'; end if;
  if (select auth.uid()) <> o.user_id and (select auth.uid()) <> driver_user then raise exception 'Not allowed' using errcode='42501'; end if;
  insert into public.conversations(participants, order_id, driver_id, conversation_type)
    values (array[o.user_id, driver_user], o.id, o.driver_id, 'customer_driver')
    on conflict (order_id) where conversation_type='customer_driver' do update set updated_at=now()
    returning id into created_conversation_id;
  if not exists (select 1 from public.messages m where m.conversation_id = created_conversation_id) then
    insert into public.messages(conversation_id,sender_id,receiver_id,message_text,message_type)
      values(created_conversation_id,null,driver_user,'New order received','system');
  end if;
  return created_conversation_id;
end $$;
revoke all on function public.start_order_conversation(uuid) from public, anon;
grant execute on function public.start_order_conversation(uuid) to authenticated;

create or replace function public.start_driver_admin_conversation(_driver_id uuid)
returns uuid language plpgsql security definer set search_path = public
as $$
declare driver_user uuid; admin_user uuid; created_conversation_id uuid;
begin
  select user_id into driver_user from public.drivers where id=_driver_id;
  if driver_user is null then raise exception 'Driver not found'; end if;
  if (select auth.uid()) = driver_user then
    select ur.user_id into admin_user from public.user_roles ur where ur.role='admin' order by ur.created_at limit 1;
  elsif public.is_staff((select auth.uid())) then admin_user := (select auth.uid());
  else raise exception 'Only this driver or Champs staff can open this chat' using errcode='42501'; end if;
  if admin_user is null then raise exception 'No Champs administrator is available'; end if;
  insert into public.conversations(participants, driver_id, conversation_type)
    values (array[driver_user, admin_user], _driver_id, 'driver_admin')
    on conflict (driver_id) where conversation_type='driver_admin' do update set participants=excluded.participants,updated_at=now()
    returning id into created_conversation_id;
  return created_conversation_id;
end $$;
revoke all on function public.start_driver_admin_conversation(uuid) from public, anon;
grant execute on function public.start_driver_admin_conversation(uuid) to authenticated;

create or replace function public.mark_conversation_read(_conversation_id uuid)
returns void language sql security invoker set search_path=public
as $$ update public.messages set read_status=true where conversation_id=_conversation_id and receiver_id=(select auth.uid()) and not read_status $$;
grant execute on function public.mark_conversation_read(uuid) to authenticated;

create or replace function public.on_new_chat_message()
returns trigger language plpgsql security definer set search_path=public
as $$
begin
  update public.conversations set updated_at=now() where id=new.conversation_id;
  if new.message_type='text' then
    insert into public.notifications(user_id,type,message,conversation_id)
      values(new.receiver_id,'new_message',left(new.message_text,160),new.conversation_id);
  end if;
  return new;
end $$;
drop trigger if exists trg_new_chat_message on public.messages;
create trigger trg_new_chat_message after insert on public.messages for each row execute function public.on_new_chat_message();

create or replace function public.on_driver_rating_changed()
returns trigger language plpgsql security definer set search_path=public
as $$
declare target uuid := coalesce(new.driver_id, old.driver_id);
begin
  update public.drivers d set rating=coalesce(x.avg_rating,0), rating_count=coalesce(x.rating_count,0)
  from (select round(avg(rating)::numeric,2) avg_rating, count(*)::int rating_count from public.driver_ratings where driver_id=target) x
  where d.id=target;
  return coalesce(new,old);
end $$;
drop trigger if exists trg_driver_rating_changed on public.driver_ratings;
create trigger trg_driver_rating_changed after insert or update or delete on public.driver_ratings for each row execute function public.on_driver_rating_changed();

create or replace function public.notify_order_workflow()
returns trigger language plpgsql security definer set search_path=public
as $$
declare driver_user uuid; conversation_id uuid; customer_message text; driver_message text;
begin
  if new.driver_id is not null then select user_id into driver_user from public.drivers where id=new.driver_id; end if;
  if tg_op='INSERT' or old.driver_id is distinct from new.driver_id then
    if new.user_id is not null then insert into public.notifications(user_id,type,message,order_id) values(new.user_id,'driver_assigned','A driver has been assigned to order '||new.order_number,new.id); end if;
    if driver_user is not null then insert into public.notifications(user_id,type,message,order_id) values(driver_user,'driver_assigned','New order '||new.order_number||' received',new.id); end if;
  end if;
  if tg_op='UPDATE' and old.workflow_status is distinct from new.workflow_status then
    customer_message := case new.workflow_status
      when 'accepted_by_driver' then 'Driver has accepted your order'
      when 'submitted_to_champs' then 'Your order has been submitted to Champs'
      when 'preparing' then 'Champs is preparing your order'
      when 'ready_for_pickup' then 'Your order is ready for pickup'
      when 'picked_up' then 'Your driver has picked up your order'
      when 'out_for_delivery' then 'Your order is out for delivery'
      when 'delivered' then 'Your order has been delivered'
      when 'rejected_by_driver' then 'The driver rejected this order'
      else 'Order status updated: '||replace(new.workflow_status,'_',' ') end;
    if new.user_id is not null then
      insert into public.notifications(user_id,type,message,order_id) values(new.user_id,case when new.workflow_status='ready_for_pickup' then 'order_ready' when new.workflow_status='delivered' then 'delivery_complete' else 'order_update' end,customer_message,new.id);
    end if;
    if driver_user is not null and new.workflow_status in ('preparing','ready_for_pickup') then
      driver_message := case new.workflow_status when 'ready_for_pickup' then 'Order '||new.order_number||' is ready for pickup' else 'Champs is preparing order '||new.order_number end;
      insert into public.notifications(user_id,type,message,order_id) values(driver_user,case when new.workflow_status='ready_for_pickup' then 'order_ready' else 'order_update' end,driver_message,new.id);
    end if;
    select id into conversation_id from public.conversations where order_id=new.id and conversation_type='customer_driver';
    if conversation_id is not null and new.user_id is not null then
      insert into public.messages(conversation_id,sender_id,receiver_id,message_text,message_type)
      values(conversation_id,null,new.user_id,customer_message,'system');
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_notify_order_workflow on public.orders;
create trigger trg_notify_order_workflow after insert or update of driver_id,workflow_status on public.orders for each row execute function public.notify_order_workflow();

create or replace function public.submit_order_to_champs(_order_id uuid)
returns void language plpgsql security definer set search_path=public
as $$
declare driver_user uuid;
begin
  select d.user_id into driver_user from public.orders o join public.drivers d on d.id=o.driver_id where o.id=_order_id;
  if driver_user <> (select auth.uid()) then raise exception 'Only the assigned driver can submit this order' using errcode='42501'; end if;
  update public.orders set workflow_status='submitted_to_champs', submitted_to_champs_at=now()
    where id=_order_id and workflow_status='accepted_by_driver' and driver_confirmed_at is not null and payment_confirmed_at is not null;
  if not found then raise exception 'Confirm the order and payment before submitting it to Champs'; end if;
  insert into public.receipt_print_jobs(order_id,requested_by) values(_order_id,(select auth.uid()));
end $$;
revoke all on function public.submit_order_to_champs(uuid) from public, anon;
grant execute on function public.submit_order_to_champs(uuid) to authenticated;

create or replace function public.review_driver_report(_report_id uuid,_status text,_resolution text default null,_driver_action text default null)
returns void language plpgsql security definer set search_path=public
as $$
declare target_driver uuid;
begin
  if not public.has_role((select auth.uid()),'admin'::public.app_role) then raise exception 'Admin access required' using errcode='42501'; end if;
  if _status not in ('reviewing','resolved','dismissed') then raise exception 'Invalid report status'; end if;
  update public.driver_reports set status=_status,resolution=nullif(trim(coalesce(_resolution,'')),''),reviewed_by=(select auth.uid()),reviewed_at=now() where id=_report_id returning driver_id into target_driver;
  if _driver_action='suspend' then update public.drivers set approval_status='suspended',suspended_at=now(),suspension_reason=_resolution,status='offline' where id=target_driver;
  elsif _driver_action='expel' then update public.drivers set approval_status='rejected',rejected_at=now(),suspension_reason=_resolution,status='offline' where id=target_driver; end if;
end $$;
revoke all on function public.review_driver_report(uuid,text,text,text) from public, anon;
grant execute on function public.review_driver_report(uuid,text,text,text) to authenticated;

alter table public.conversations replica identity full;
alter table public.messages replica identity full;
alter table public.notifications replica identity full;
alter table public.receipt_print_jobs replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.conversations;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.receipt_print_jobs;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.orders;
exception when duplicate_object then null; end $$;
