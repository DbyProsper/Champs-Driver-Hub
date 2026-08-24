-- One explicit read policy covers customers, assigned drivers and Champs staff.
-- This replaces the former public policy without accidentally hiding orders
-- from the admin dashboard.
drop policy if exists "Customers read own orders" on public.orders;
drop policy if exists "Drivers read assigned order" on public.orders;
drop policy if exists "Authorized users read orders" on public.orders;
create policy "Authorized users read orders" on public.orders for select to authenticated
using (
  user_id = (select auth.uid())
  or public.is_staff((select auth.uid()))
  or exists (
    select 1 from public.drivers d
    where d.id = orders.driver_id and d.user_id = (select auth.uid())
  )
);

drop policy if exists "orders anyone create" on public.orders;
create policy "Signed in customers create orders" on public.orders for insert to authenticated
with check (
  length(customer_name) between 1 and 100
  and length(customer_phone) between 5 and 20
  and status = 'pending'::public.order_status
  and subtotal_cents >= 0
  and branch_id is not null
  and user_id = (select auth.uid())
  and verified_at is null
  and verified_by is null
);
