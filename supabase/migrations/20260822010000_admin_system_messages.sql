-- Keep chat notifications navigable and place Champs-authored operational
-- messages in the correct driver/admin, order-scoped conversation.
create or replace function public.on_new_chat_message()
returns trigger language plpgsql security definer set search_path=''
as $$
declare related_order uuid;
begin
  update public.conversations set updated_at=now() where id=new.conversation_id;
  select c.order_id into related_order from public.conversations c where c.id=new.conversation_id;
  if new.message_type='text' then
    insert into public.notifications(user_id,type,message,order_id,conversation_id)
    values(new.receiver_id,'new_message',left(new.message_text,160),related_order,new.conversation_id);
  end if;
  return new;
end $$;

create or replace function public.champs_driver_system_message()
returns trigger language plpgsql security definer set search_path=''
as $$
declare driver_user uuid; admin_user uuid; conversation_id uuid; body text;
begin
  if new.driver_id is null or new.workflow_status not in ('submitted_to_champs','preparing','ready_for_pickup') then return new; end if;
  if tg_op='UPDATE' and old.workflow_status is not distinct from new.workflow_status then return new; end if;
  select d.user_id into driver_user from public.drivers d where d.id=new.driver_id;
  select ur.user_id into admin_user from public.user_roles ur where ur.role='admin'::public.app_role order by ur.created_at limit 1;
  if driver_user is null or admin_user is null then return new; end if;
  insert into public.conversations(participants,order_id,driver_id,conversation_type)
  values(array[driver_user,admin_user],new.id,new.driver_id,'driver_admin')
  on conflict(driver_id,order_id) where conversation_type='driver_admin' and order_id is not null
  do update set participants=excluded.participants,updated_at=now()
  returning id into conversation_id;
  body := case new.workflow_status
    when 'submitted_to_champs' then 'Champs Admin: Order '||new.order_number||' has been received by Champs'
    when 'preparing' then 'Champs Admin: Order '||new.order_number||' is being prepared'
    else 'Champs Admin: Order '||new.order_number||' is ready for pickup' end;
  insert into public.messages(conversation_id,sender_id,receiver_id,message_text,message_type)
  values(conversation_id,null,driver_user,body,'system');
  return new;
end $$;
drop trigger if exists trg_champs_driver_system_message on public.orders;
create trigger trg_champs_driver_system_message after insert or update of workflow_status on public.orders
for each row execute function public.champs_driver_system_message();

create or replace function public.champs_driver_account_message()
returns trigger language plpgsql security definer set search_path=''
as $$
declare admin_user uuid; conversation_id uuid; body text;
begin
  if new.user_id is null or old.approval_status is not distinct from new.approval_status then return new; end if;
  if new.approval_status not in ('suspended','rejected') then return new; end if;
  select ur.user_id into admin_user from public.user_roles ur where ur.role='admin'::public.app_role order by ur.created_at limit 1;
  if admin_user is null then return new; end if;
  insert into public.conversations(participants,driver_id,conversation_type)
  values(array[new.user_id,admin_user],new.id,'driver_admin')
  on conflict(driver_id) where conversation_type='driver_admin' and order_id is null
  do update set participants=excluded.participants,updated_at=now()
  returning id into conversation_id;
  body := 'Champs Admin: Your driver account has been '||new.approval_status||coalesce('. Reason: '||new.suspension_reason,'');
  insert into public.messages(conversation_id,sender_id,receiver_id,message_text,message_type)
  values(conversation_id,null,new.user_id,body,'system');
  insert into public.notifications(user_id,type,message,conversation_id)
  values(new.user_id,'driver_status',body,conversation_id);
  return new;
end $$;
drop trigger if exists trg_champs_driver_account_message on public.drivers;
create trigger trg_champs_driver_account_message after update of approval_status on public.drivers
for each row execute function public.champs_driver_account_message();
