-- Mobile-first menu controls, user notification preferences, rating milestones,
-- and kitchen preparation automation.

alter table public.menu_items
  add column if not exists special_price_cents integer check (special_price_cents is null or special_price_cents >= 0),
  add column if not exists burger_only_price_cents integer check (burger_only_price_cents is null or burger_only_price_cents >= 0),
  add column if not exists icon_text text;

alter table public.menu_items
  drop constraint if exists menu_items_special_price_lower_check;
alter table public.menu_items
  add constraint menu_items_special_price_lower_check
  check (special_price_cents is null or special_price_cents < price_cents);

create index if not exists menu_items_category_sort_idx
  on public.menu_items(category_id, sort_order, name);

create or replace function public.reorder_menu_items(_first_id uuid, _second_id uuid)
returns void language plpgsql security invoker set search_path = public as $$
declare first_sort integer; second_sort integer; first_cat uuid; second_cat uuid;
begin
  if not public.is_staff((select auth.uid())) then raise exception 'Staff access required'; end if;
  select sort_order, category_id into first_sort, first_cat from public.menu_items where id = _first_id for update;
  select sort_order, category_id into second_sort, second_cat from public.menu_items where id = _second_id for update;
  if first_cat is distinct from second_cat then raise exception 'Items must belong to the same category'; end if;
  update public.menu_items set sort_order = case id when _first_id then second_sort else first_sort end
   where id in (_first_id, _second_id);
end;
$$;
revoke all on function public.reorder_menu_items(uuid,uuid) from public, anon;
grant execute on function public.reorder_menu_items(uuid,uuid) to authenticated;

create table if not exists public.user_notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  in_app_enabled boolean not null default true,
  browser_enabled boolean not null default true,
  order_updates boolean not null default true,
  message_alerts boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.user_notification_preferences enable row level security;
grant select, insert, update on public.user_notification_preferences to authenticated;
drop policy if exists "Users manage own notification preferences" on public.user_notification_preferences;
create policy "Users manage own notification preferences"
  on public.user_notification_preferences for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

alter table public.delivery_settings
  add column if not exists auto_ready_mode text not null default 'prompt'
  check (auto_ready_mode in ('automatic', 'prompt'));

-- An order is a kitchen order as soon as the driver submits it to Champs.
create or replace function public.start_kitchen_preparation()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if new.workflow_status = 'submitted_to_champs'
     and old.workflow_status is distinct from new.workflow_status then
    new.status := 'preparing';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_start_kitchen_preparation on public.orders;
create trigger trg_start_kitchen_preparation
before update of workflow_status on public.orders
for each row execute function public.start_kitchen_preparation();

-- Called by the admin client and safe for pg_cron use if enabled later.
create or replace function public.advance_due_kitchen_orders()
returns integer language plpgsql security invoker set search_path = public as $$
declare changed integer;
begin
  if not public.is_staff((select auth.uid())) and (select auth.uid()) is not null then
    raise exception 'Staff access required';
  end if;
  update public.orders o
     set status = 'ready', workflow_status = 'ready_for_pickup'
    from public.delivery_settings ds
   where ds.id = 'default'
     and ds.auto_ready_mode = 'automatic'
     and o.status = 'preparing'
     and o.updated_at <= now() - make_interval(mins => ds.base_prep_min);
  get diagnostics changed = row_count;
  return changed;
end;
$$;
revoke all on function public.advance_due_kitchen_orders() from public, anon;
grant execute on function public.advance_due_kitchen_orders() to authenticated, service_role;

-- Notify every staff account of driver-originated messages. The direct receiver
-- already receives the standard message notification, so duplicates are avoided.
create or replace function public.notify_staff_of_driver_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare sender_driver uuid;
begin
  select d.id into sender_driver from public.drivers d where d.user_id = new.sender_id;
  if sender_driver is null then return new; end if;

  insert into public.notifications(user_id, type, message, order_id, conversation_id)
  select distinct ur.user_id, 'new_message', left(new.message_text, 160), c.order_id, new.conversation_id
    from public.user_roles ur
    join public.conversations c on c.id = new.conversation_id
   where ur.role in ('admin', 'staff')
     and ur.user_id is distinct from new.receiver_id;
  return new;
end;
$$;
drop trigger if exists trg_notify_staff_of_driver_message on public.messages;
create trigger trg_notify_staff_of_driver_message
after insert on public.messages for each row
when (new.sender_id is not null)
execute function public.notify_staff_of_driver_message();
revoke all on function public.notify_staff_of_driver_message() from public, anon, authenticated;

-- Every fifth 4–5 star review creates an encouraging general driver message.
create or replace function public.encourage_driver_rating_milestone()
returns trigger language plpgsql security definer set search_path = public as $$
declare good_count integer; driver_user uuid; admin_user uuid; conv_id uuid; body text;
begin
  if new.rating < 4 then return new; end if;
  select count(*) into good_count from public.driver_ratings
   where driver_id = new.driver_id and rating between 4 and 5;
  if good_count = 0 or good_count % 5 <> 0 then return new; end if;
  select user_id into driver_user from public.drivers where id = new.driver_id;
  select user_id into admin_user from public.user_roles where role in ('admin','staff') order by role = 'admin' desc limit 1;
  if driver_user is null then return new; end if;
  insert into public.conversations(participants, driver_id, conversation_type)
  values(array_remove(array[driver_user, admin_user], null), new.driver_id, 'driver_admin')
  on conflict (driver_id) where conversation_type = 'driver_admin' and order_id is null
  do update set updated_at = now() returning id into conv_id;
  body := 'Great work! You have received ' || good_count || ' ratings of 4 or 5 stars. Your customers are happy—keep up the excellent service!';
  insert into public.messages(conversation_id, sender_id, receiver_id, message_text, message_type)
  values(conv_id, null, driver_user, body, 'system');
  insert into public.notifications(user_id, type, message, conversation_id)
  values(driver_user, 'rating_milestone', body, conv_id);
  return new;
end;
$$;
drop trigger if exists trg_encourage_driver_rating_milestone on public.driver_ratings;
create trigger trg_encourage_driver_rating_milestone
after insert on public.driver_ratings for each row
execute function public.encourage_driver_rating_milestone();
revoke all on function public.encourage_driver_rating_milestone() from public, anon, authenticated;

do $$ begin
  alter publication supabase_realtime add table public.user_notification_preferences;
exception when duplicate_object then null;
end $$;
