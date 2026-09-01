-- Driver-to-customer chat belongs only to the assigned customer. Staff bell
-- notifications are created only for driver-admin conversations.
create or replace function public.notify_staff_of_driver_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  sender_driver uuid;
  target_conversation public.conversations%rowtype;
begin
  select d.id into sender_driver
  from public.drivers d
  where d.user_id = new.sender_id;

  if sender_driver is null then return new; end if;

  select c.* into target_conversation
  from public.conversations c
  where c.id = new.conversation_id;

  if target_conversation.conversation_type is distinct from 'driver_admin' then
    return new;
  end if;

  insert into public.notifications(user_id, type, message, order_id, conversation_id)
  select distinct ur.user_id, 'new_message', left(new.message_text, 160),
         target_conversation.order_id, new.conversation_id
  from public.user_roles ur
  where ur.role in ('admin', 'staff')
    and ur.user_id is distinct from new.receiver_id;

  return new;
end;
$$;
revoke all on function public.notify_staff_of_driver_message() from public, anon, authenticated;

-- Remove only exact duplicate rows produced within a five-second burst.
delete from public.notifications duplicate
using public.notifications original
where duplicate.user_id = original.user_id
  and duplicate.type = original.type
  and duplicate.message = original.message
  and duplicate.order_id is not distinct from original.order_id
  and duplicate.conversation_id is not distinct from original.conversation_id
  and duplicate.created_at > original.created_at
  and duplicate.created_at <= original.created_at + interval '5 seconds';

create index if not exists notifications_recent_dedupe_idx
on public.notifications(user_id, type, order_id, conversation_id, created_at desc);

-- Protect every notification source from accidental repeated trigger execution
-- while still allowing the same meaningful alert again later.
create or replace function public.prevent_duplicate_notification_burst()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.notifications existing
    where existing.user_id = new.user_id
      and existing.type = new.type
      and existing.message = new.message
      and existing.order_id is not distinct from new.order_id
      and existing.conversation_id is not distinct from new.conversation_id
      and existing.created_at >= new.created_at - interval '5 seconds'
      and existing.created_at <= new.created_at
  ) then
    return null;
  end if;
  return new;
end;
$$;
revoke all on function public.prevent_duplicate_notification_burst() from public, anon, authenticated;

drop trigger if exists trg_prevent_duplicate_notification_burst on public.notifications;
create trigger trg_prevent_duplicate_notification_burst
before insert on public.notifications
for each row execute function public.prevent_duplicate_notification_burst();
