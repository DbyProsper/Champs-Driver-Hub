-- Public homepage media uploaded by authorized Champs staff.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('site-assets','site-assets',true,5242880,array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update set public=true,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists "Public read site assets" on storage.objects;
create policy "Public read site assets" on storage.objects for select
to public using (bucket_id='site-assets');
drop policy if exists "Staff upload site assets" on storage.objects;
create policy "Staff upload site assets" on storage.objects for insert
to authenticated with check (bucket_id='site-assets' and public.is_staff((select auth.uid())));
drop policy if exists "Staff update site assets" on storage.objects;
create policy "Staff update site assets" on storage.objects for update
to authenticated using (bucket_id='site-assets' and public.is_staff((select auth.uid())))
with check (bucket_id='site-assets' and public.is_staff((select auth.uid())));
drop policy if exists "Staff delete site assets" on storage.objects;
create policy "Staff delete site assets" on storage.objects for delete
to authenticated using (bucket_id='site-assets' and public.is_staff((select auth.uid())));

insert into public.media_assets(title,image_key,src,alt,usage,is_active,sort_order)
values
  ('Champs burger','burger-card','/images/champs/champs-burger.jpg','Fresh Champs burger','homepage-card',true,40),
  ('Champs shakes','shakes-card','/images/champs/champs-shakes.jpg','Cold Champs shakes','homepage-card',true,50)
on conflict (image_key) do update set
  title=excluded.title,src=excluded.src,alt=excluded.alt,usage=excluded.usage,is_active=true;

update public.customer_complaints c
set driver_id=o.driver_id
from public.orders o
where c.order_id=o.id and c.driver_id is null and o.driver_id is not null;

drop policy if exists "Customers create own complaints" on public.customer_complaints;
create policy "Customers create own complaints" on public.customer_complaints for insert to authenticated
with check (
  customer_id=(select auth.uid())
  and (
    (order_id is null and driver_id is null)
    or exists (
      select 1 from public.orders o
      where o.id=order_id and o.user_id=(select auth.uid())
        and driver_id is not distinct from o.driver_id
    )
  )
);

-- A written Champs response is important even when the status remains reviewing.
create or replace function public.notify_complaint_update()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if old.status is distinct from new.status or old.resolution is distinct from new.resolution then
    insert into public.notifications(user_id,type,message,order_id)
    values(
      new.customer_id,
      'complaint_update',
      case when new.resolution is distinct from old.resolution and new.resolution is not null
        then 'Champs responded to your complaint: '||left(new.subject,100)
        else 'Your complaint is now '||replace(new.status,'_',' ') end,
      new.order_id
    );
  end if;
  return new;
end $$;
drop trigger if exists trg_notify_complaint_update on public.customer_complaints;
create trigger trg_notify_complaint_update after update of status,resolution on public.customer_complaints
for each row execute function public.notify_complaint_update();

do $$ begin
  alter publication supabase_realtime add table public.site_settings;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.media_assets;
exception when duplicate_object then null; end $$;
