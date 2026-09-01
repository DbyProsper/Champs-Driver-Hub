-- Preserve the existing driver-owned location policy while layering active-trip
-- restrictions over writes. Restrictive policies are ANDed with the original
-- permissive policy, so drivers still own their row but cannot publish location
-- outside an active picked-up or on-the-way delivery.
drop policy if exists "Driver reads own location" on public.driver_locations;
drop policy if exists "Driver inserts active location" on public.driver_locations;
drop policy if exists "Driver updates active location" on public.driver_locations;

do $$
begin
  if not exists (
    select 1
    from pg_policy
    where polrelid = 'public.driver_locations'::regclass
      and polname = 'Driver writes own location'
  ) then
    create policy "Driver writes own location"
    on public.driver_locations for all to authenticated
    using (
      exists (
        select 1 from public.drivers d
        where d.id = driver_locations.driver_id
          and d.user_id = (select auth.uid())
      )
    )
    with check (
      exists (
        select 1 from public.drivers d
        where d.id = driver_locations.driver_id
          and d.user_id = (select auth.uid())
      )
    );
  end if;
end $$;

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
