drop function if exists public.list_available_drivers(double precision,double precision);
create function public.list_available_drivers(_latitude double precision default null, _longitude double precision default null, _branch_id uuid default null)
returns table(driver_id uuid, user_id uuid, name text, profile_image_url text, phone text, rating numeric, distance_km numeric, status text)
language sql stable security definer set search_path='' as $$
  with candidates as (
    select d.*, dl.latitude as live_latitude, dl.longitude as live_longitude,
      case when _latitude is null or _longitude is null or dl.latitude is null or dl.longitude is null then null
        else round((6371 * acos(least(1, greatest(-1,
          cos(radians(_latitude)) * cos(radians(dl.latitude)) * cos(radians(dl.longitude) - radians(_longitude)) + sin(radians(_latitude)) * sin(radians(dl.latitude))
        ))))::numeric, 2) end as live_distance
    from public.drivers d
    left join lateral (
      select l.latitude,l.longitude from public.driver_locations l where l.driver_id=d.id order by l.updated_at desc limit 1
    ) dl on true
    where d.user_id is not null and d.approval_status='approved'
      and (d.suspended_until is null or d.suspended_until <= now())
      and _branch_id is not null and d.branch_id=_branch_id
  )
  select c.id,c.user_id,c.name,c.profile_image_url,c.phone,c.rating,c.live_distance,
    case when c.status='active' and (select count(*) from public.deliveries x where x.driver_id=c.id and x.status not in ('delivered','cancelled')) < c.active_order_limit then 'online' else 'offline' end
  from candidates c
  where c.live_distance is null or c.live_distance <= 6
  order by 8 desc,7 nulls last,c.rating desc,c.name;
$$;
revoke all on function public.list_available_drivers(double precision,double precision,uuid) from public,anon;
grant execute on function public.list_available_drivers(double precision,double precision,uuid) to authenticated;

create or replace function public.validate_local_assigned_driver() returns trigger language plpgsql security definer set search_path='' as $$
declare driver_branch uuid; driver_lat double precision; driver_lng double precision; separation double precision;
begin
  if new.fulfillment <> 'delivery' or new.driver_id is null then return new; end if;
  select d.branch_id into driver_branch from public.drivers d where d.id=new.driver_id and d.approval_status='approved';
  if driver_branch is null or driver_branch <> new.branch_id then raise exception 'The selected driver does not serve this branch'; end if;
  select l.latitude,l.longitude into driver_lat,driver_lng from public.driver_locations l where l.driver_id=new.driver_id order by l.updated_at desc limit 1;
  if driver_lat is not null and driver_lng is not null and new.delivery_lat is not null and new.delivery_lng is not null then
    separation := 6371 * acos(least(1,greatest(-1,cos(radians(new.delivery_lat))*cos(radians(driver_lat))*cos(radians(driver_lng)-radians(new.delivery_lng))+sin(radians(new.delivery_lat))*sin(radians(driver_lat)))));
    if separation > 6 then raise exception 'The selected driver is outside your delivery area'; end if;
  end if;
  return new;
end $$;
revoke all on function public.validate_local_assigned_driver() from public,anon,authenticated;
drop trigger if exists trg_validate_local_assigned_driver on public.orders;
create trigger trg_validate_local_assigned_driver before insert or update of driver_id,branch_id,delivery_lat,delivery_lng on public.orders for each row execute function public.validate_local_assigned_driver();

-- Old browser sessions must never replay historical print jobs.
update public.receipt_print_jobs set status='failed' where status='pending' and created_at < now() - interval '5 minutes';
