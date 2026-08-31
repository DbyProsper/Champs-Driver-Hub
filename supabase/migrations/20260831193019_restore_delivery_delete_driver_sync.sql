-- Keep orders.driver_id synchronized when a delivery is removed as well as
-- when it is inserted or reassigned.
drop trigger if exists trg_sync_order_driver_from_delivery on public.deliveries;
create trigger trg_sync_order_driver_from_delivery
before insert or delete or update of driver_id on public.deliveries
for each row execute function public.sync_order_driver_from_delivery();
