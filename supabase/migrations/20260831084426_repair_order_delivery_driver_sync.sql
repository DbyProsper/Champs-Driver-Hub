-- Keep the order and delivery assignment in one consistent state. The previous
-- trigger ran with the caller's RLS permissions, so a customer/driver delivery
-- update could succeed while the matching order update was silently blocked.
create or replace function public.sync_order_driver_from_delivery()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    update public.orders
    set driver_id = null
    where id = old.order_id
      and driver_id is not null;
    return old;
  end if;

  update public.orders
  set driver_id = new.driver_id
  where id = new.order_id
    and driver_id is distinct from new.driver_id;

  return new;
end;
$$;

-- Preserve the driver selected at checkout when the automatic delivery row is
-- created. Previously the delivery was inserted without a driver and its sync
-- trigger immediately cleared orders.driver_id.
create or replace function public.create_delivery_for_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.fulfillment = 'delivery' then
    insert into public.deliveries (
      order_id,
      driver_id,
      distance_km,
      delivery_fee_cents,
      status
    )
    values (
      new.id,
      new.driver_id,
      new.distance_km,
      coalesce(new.delivery_fee_cents, 0),
      case when new.driver_id is null then 'pending' else 'pending_driver_acceptance' end
    )
    on conflict (order_id) do update
      set driver_id = excluded.driver_id,
          distance_km = excluded.distance_km,
          delivery_fee_cents = excluded.delivery_fee_cents,
          status = excluded.status;
  end if;
  return new;
end;
$$;

-- RLS helpers avoid recursive policies between orders, deliveries and drivers.
create or replace function private.current_driver_has_order(_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.deliveries dl
    join public.drivers d on d.id = dl.driver_id
    where dl.order_id = _order_id
      and d.user_id = (select auth.uid())
  );
$$;

create or replace function private.customer_has_assigned_driver(_driver_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.orders o
    left join public.deliveries dl on dl.order_id = o.id
    where o.user_id = (select auth.uid())
      and coalesce(dl.driver_id, o.driver_id) = _driver_id
  );
$$;

revoke all on function private.current_driver_has_order(uuid) from public;
revoke all on function private.customer_has_assigned_driver(uuid) from public;
grant execute on function private.current_driver_has_order(uuid) to authenticated;
grant execute on function private.customer_has_assigned_driver(uuid) to authenticated;

drop policy if exists "Authorized users read orders" on public.orders;
create policy "Authorized users read orders"
on public.orders for select to authenticated
using (
  user_id = (select auth.uid())
  or private.is_staff((select auth.uid()))
  or private.current_driver_has_order(id)
);

drop policy if exists "Customer reads assigned driver" on public.drivers;
create policy "Customer reads assigned driver"
on public.drivers for select to authenticated
using (private.customer_has_assigned_driver(id));

-- Repair records created while the old trigger was active.
update public.orders o
set driver_id = dl.driver_id,
    workflow_status = case
      when dl.status = 'accepted'
        and o.workflow_status in ('pending', 'pending_driver_acceptance')
      then 'accepted_by_driver'
      else o.workflow_status
    end
from public.deliveries dl
where dl.order_id = o.id
  and (
    o.driver_id is distinct from dl.driver_id
    or (
      dl.status = 'accepted'
      and o.workflow_status in ('pending', 'pending_driver_acceptance')
    )
  );
