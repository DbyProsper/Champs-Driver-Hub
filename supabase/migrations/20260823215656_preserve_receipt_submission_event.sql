-- Preserve submitted_to_champs for receipt creation while moving the kitchen
-- status to preparing immediately.
create or replace function public.start_kitchen_preparation()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if new.workflow_status = 'submitted_to_champs'
     and old.workflow_status is distinct from new.workflow_status then
    new.status := 'preparing';
  end if;
  return new;
end;
$$;
