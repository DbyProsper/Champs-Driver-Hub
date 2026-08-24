-- Only Auth-linked drivers can receive customer orders or chats.
update public.drivers set status = 'active' where status = 'online';

create or replace function public.online_drivers_count()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.drivers d
  where d.user_id is not null
    and d.status = 'active'
    and d.approval_status = 'approved'
    and (d.suspended_until is null or d.suspended_until <= now())
    and (
      select count(*)
      from public.deliveries active_delivery
      where active_delivery.driver_id = d.id
        and active_delivery.status not in ('delivered', 'cancelled')
    ) < d.active_order_limit;
$$;
revoke execute on function public.online_drivers_count() from public;
grant execute on function public.online_drivers_count() to anon, authenticated;

create or replace function public.list_available_drivers(_latitude double precision default null, _longitude double precision default null)
returns table(driver_id uuid, user_id uuid, name text, profile_image_url text, phone text, rating numeric, distance_km numeric, status text)
language sql
stable
security definer
set search_path = public
as $$
  select d.id, d.user_id, d.name, d.profile_image_url, d.phone, d.rating,
    case when _latitude is null or _longitude is null or dl.latitude is null or dl.longitude is null then null
      else round((6371 * acos(least(1, greatest(-1,
        cos(radians(_latitude)) * cos(radians(dl.latitude)) * cos(radians(dl.longitude) - radians(_longitude)) + sin(radians(_latitude)) * sin(radians(dl.latitude))
      ))))::numeric, 2) end,
    case when d.status = 'active'
      and (select count(*) from public.deliveries active_delivery where active_delivery.driver_id=d.id and active_delivery.status not in ('delivered','cancelled')) < d.active_order_limit
      then 'online' else 'offline' end
  from public.drivers d
  left join lateral (
    select l.latitude, l.longitude from public.driver_locations l where l.driver_id = d.id order by l.updated_at desc limit 1
  ) dl on true
  where (select auth.uid()) is not null
    and d.user_id is not null
    and d.approval_status = 'approved'
    and (d.suspended_until is null or d.suspended_until <= now())
  order by 8 desc, 7 nulls last, d.rating desc, d.name;
$$;
revoke all on function public.list_available_drivers(double precision,double precision) from public, anon;
grant execute on function public.list_available_drivers(double precision,double precision) to authenticated;
