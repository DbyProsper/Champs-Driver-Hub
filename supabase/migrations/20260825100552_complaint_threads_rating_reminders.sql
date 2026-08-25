create table if not exists public.complaint_messages (
  id uuid primary key default gen_random_uuid(),
  complaint_id uuid not null references public.customer_complaints(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  message_text text not null check (char_length(btrim(message_text)) between 1 and 4000),
  created_at timestamptz not null default now()
);

alter table public.complaint_messages enable row level security;
grant select, insert on public.complaint_messages to authenticated;
grant all on public.complaint_messages to service_role;
create index if not exists complaint_messages_thread_idx on public.complaint_messages(complaint_id, created_at);

create policy "Complaint participants read messages" on public.complaint_messages for select to authenticated
using (
  exists (select 1 from public.customer_complaints c where c.id=complaint_id and c.customer_id=(select auth.uid()))
  or public.is_staff((select auth.uid()))
);
create policy "Complaint participants send messages" on public.complaint_messages for insert to authenticated
with check (
  sender_id=(select auth.uid()) and (
    exists (select 1 from public.customer_complaints c where c.id=complaint_id and c.customer_id=(select auth.uid()) and c.status not in ('resolved','dismissed'))
    or public.is_staff((select auth.uid()))
  )
);

insert into public.complaint_messages(complaint_id,sender_id,message_text,created_at)
select c.id,c.customer_id,c.details,c.created_at from public.customer_complaints c
where not exists(select 1 from public.complaint_messages m where m.complaint_id=c.id);

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in (
  'new_message','order_update','driver_assigned','order_ready','delivery_complete','driver_report','complaint_update','driver_status','rating_request'
));

create or replace function public.notify_rating_after_delivery() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.workflow_status='delivered' and old.workflow_status is distinct from 'delivered' and new.user_id is not null and new.driver_id is not null then
    insert into public.notifications(user_id,type,message,order_id)
    values(new.user_id,'rating_request','How was your delivery? Rate your driver and share your experience.',new.id);
  end if;
  return new;
end $$;
revoke all on function public.notify_rating_after_delivery() from public,anon,authenticated;
drop trigger if exists trg_notify_rating_after_delivery on public.orders;
create trigger trg_notify_rating_after_delivery after update of workflow_status on public.orders
for each row execute function public.notify_rating_after_delivery();

create or replace function public.notify_complaint_message() returns trigger language plpgsql security definer set search_path='' as $$
declare c public.customer_complaints%rowtype;
begin
  select * into c from public.customer_complaints where id=new.complaint_id;
  if new.sender_id=c.customer_id then
    insert into public.notifications(user_id,type,message,order_id)
    select ur.user_id,'complaint_update','New customer reply: '||left(c.subject,100),c.order_id
    from public.user_roles ur where ur.role in ('admin','staff');
  else
    insert into public.notifications(user_id,type,message,order_id)
    values(c.customer_id,'complaint_update','Champs replied to your complaint: '||left(c.subject,100),c.order_id);
  end if;
  return new;
end $$;
revoke all on function public.notify_complaint_message() from public,anon,authenticated;
drop trigger if exists trg_notify_complaint_message on public.complaint_messages;
create trigger trg_notify_complaint_message after insert on public.complaint_messages
for each row execute function public.notify_complaint_message();

do $$ begin alter publication supabase_realtime add table public.complaint_messages; exception when duplicate_object then null; end $$;
