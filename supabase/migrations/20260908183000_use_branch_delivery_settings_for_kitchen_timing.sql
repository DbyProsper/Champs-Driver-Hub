create or replace function public.advance_due_kitchen_orders()
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare changed integer;
begin
  if not public.is_staff((select auth.uid())) and (select auth.uid()) is not null then
    raise exception 'Staff access required';
  end if;

  update public.orders o
     set status = 'ready', workflow_status = 'ready_for_pickup'
   where coalesce(
           (select ds.auto_ready_mode from public.delivery_settings ds where ds.branch_id = o.branch_id),
           (select ds.auto_ready_mode from public.delivery_settings ds where ds.id = 'default')
         ) = 'automatic'
     and o.status = 'preparing'
     and o.updated_at <= now() - make_interval(mins => coalesce(
           (select ds.base_prep_min from public.delivery_settings ds where ds.branch_id = o.branch_id),
           (select ds.base_prep_min from public.delivery_settings ds where ds.id = 'default')
         ));

  get diagnostics changed = row_count;
  return changed;
end;
$$;

