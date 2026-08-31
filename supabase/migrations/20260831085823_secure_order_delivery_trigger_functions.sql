-- These functions are invoked only by database triggers. They must not be
-- callable as public RPC endpoints, especially because they run as definer.
revoke all on function public.sync_order_driver_from_delivery() from public, anon, authenticated;
revoke all on function public.create_delivery_for_order() from public, anon, authenticated;
