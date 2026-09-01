-- driver_locations already exists and is the canonical latest-location table.
-- Keep one current row per driver so mobile tracking can update instead of
-- accumulating GPS samples.
delete from public.driver_locations older
using public.driver_locations newer
where older.driver_id = newer.driver_id
  and (older.updated_at, older.id) < (newer.updated_at, newer.id);

create unique index if not exists driver_locations_driver_id_key
  on public.driver_locations(driver_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'driver_locations_valid_coordinates'
      and conrelid = 'public.driver_locations'::regclass
  ) then
    alter table public.driver_locations
      add constraint driver_locations_valid_coordinates
      check (latitude between -90 and 90 and longitude between -180 and 180);
  end if;
end $$;

drop policy if exists "Driver inserts active location" on public.driver_locations;
drop policy if exists "Driver updates active location" on public.driver_locations;
drop policy if exists "Customer reads assigned active driver location" on public.driver_locations;

create policy "Driver inserts active location"
on public.driver_locations as restrictive for insert to authenticated
with check (
  exists (
    select 1
    from public.drivers d
    join public.deliveries active on active.driver_id = d.id
    where d.id = driver_locations.driver_id
      and d.user_id = (select auth.uid())
      and d.status = 'active'
      and active.status in ('picked_up', 'on_the_way')
  )
);

create policy "Driver updates active location"
on public.driver_locations as restrictive for update to authenticated
using (
  exists (
    select 1
    from public.drivers d
    join public.deliveries active on active.driver_id = d.id
    where d.id = driver_locations.driver_id
      and d.user_id = (select auth.uid())
      and d.status = 'active'
      and active.status in ('picked_up', 'on_the_way')
  )
)
with check (
  exists (
    select 1
    from public.drivers d
    join public.deliveries active on active.driver_id = d.id
    where d.id = driver_locations.driver_id
      and d.user_id = (select auth.uid())
      and d.status = 'active'
      and active.status in ('picked_up', 'on_the_way')
  )
);

create policy "Customer reads assigned active driver location"
on public.driver_locations for select to authenticated
using (
  exists (
    select 1
    from public.deliveries active
    join public.orders o on o.id = active.order_id
    where active.driver_id = driver_locations.driver_id
      and o.user_id = (select auth.uid())
      and active.status in ('picked_up', 'on_the_way')
  )
);
