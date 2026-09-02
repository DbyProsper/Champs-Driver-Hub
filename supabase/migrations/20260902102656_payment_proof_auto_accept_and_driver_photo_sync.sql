-- A payment-proof upload is an explicit commitment to the selected driver.
-- Accept the assignment atomically so the driver sees it under Active and the
-- order cannot be rejected after the customer has transferred money.
create or replace function public.submit_delivery_payment(
  _delivery_id uuid,
  _payment_reference text,
  _proof_path text default null
)
returns table(out_delivery_id uuid, out_payment_status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_order_id uuid;
  target_order_user_id uuid;
  assigned_driver_id uuid;
  current_delivery_status text;
  proof_supplied boolean := nullif(trim(coalesce(_proof_path, '')), '') is not null;
  next_queue_position integer;
begin
  if auth.uid() is null then
    raise exception 'Sign in before submitting payment proof' using errcode = '42501';
  end if;

  select d.order_id, o.user_id, d.driver_id, d.status
  into target_order_id, target_order_user_id, assigned_driver_id, current_delivery_status
  from public.deliveries d
  join public.orders o on o.id = d.order_id
  where d.id = _delivery_id
  for update of d, o;

  if target_order_id is null then
    raise exception 'Delivery order not found' using errcode = 'P0002';
  end if;
  if target_order_user_id is null or target_order_user_id <> auth.uid() then
    raise exception 'You can only submit payment for your own delivery order' using errcode = '42501';
  end if;
  if proof_supplied and assigned_driver_id is null then
    raise exception 'Select a driver before uploading proof of payment' using errcode = '23514';
  end if;

  if proof_supplied and current_delivery_status in ('pending', 'pending_driver_acceptance') then
    select coalesce(max(d.queue_position), 0) + 1
    into next_queue_position
    from public.deliveries d
    where d.driver_id = assigned_driver_id
      and d.status not in ('delivered', 'cancelled');
  end if;

  update public.deliveries d
  set payment_status = 'pending',
      payment_reference = trim(_payment_reference),
      proof_of_payment_url = coalesce(nullif(trim(coalesce(_proof_path, '')), ''), d.proof_of_payment_url),
      status = case
        when proof_supplied and d.status in ('pending', 'pending_driver_acceptance') then 'accepted'
        else d.status
      end,
      queue_position = case
        when proof_supplied and d.status in ('pending', 'pending_driver_acceptance') then coalesce(d.queue_position, next_queue_position)
        else d.queue_position
      end,
      updated_at = now()
  where d.id = _delivery_id;

  if proof_supplied then
    update public.orders o
    set workflow_status = case
          when o.workflow_status in ('pending', 'pending_driver_acceptance', 'rejected_by_driver') then 'accepted_by_driver'
          else o.workflow_status
        end,
        driver_confirmed_at = coalesce(o.driver_confirmed_at, now()),
        updated_at = now()
    where o.id = target_order_id;
  end if;

  return query select _delivery_id, 'pending'::text;
end;
$$;
revoke all on function public.submit_delivery_payment(uuid, text, text) from public, anon;
grant execute on function public.submit_delivery_payment(uuid, text, text) to authenticated;

create or replace function public.prevent_driver_order_rejection_after_proof()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.workflow_status = 'rejected_by_driver'
     and old.workflow_status is distinct from new.workflow_status
     and exists (
       select 1
       from public.deliveries dl
       join public.drivers dr on dr.id = dl.driver_id
       where dl.order_id = old.id
         and dr.user_id = auth.uid()
         and nullif(trim(coalesce(dl.proof_of_payment_url, '')), '') is not null
     ) then
    raise exception 'This order cannot be rejected because the customer has submitted proof of payment.' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.prevent_driver_order_rejection_after_proof() from public, anon, authenticated;

drop trigger if exists trg_prevent_driver_order_rejection_after_proof on public.orders;
create trigger trg_prevent_driver_order_rejection_after_proof
before update of workflow_status on public.orders
for each row execute function public.prevent_driver_order_rejection_after_proof();

create or replace function public.prevent_driver_delivery_rejection_after_proof()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(trim(coalesce(old.proof_of_payment_url, '')), '') is not null
     and old.driver_id is not null
     and (
       new.driver_id is distinct from old.driver_id
       or new.status in ('pending', 'pending_driver_acceptance')
     )
     and exists (
       select 1 from public.drivers dr
       where dr.id = old.driver_id and dr.user_id = auth.uid()
     ) then
    raise exception 'This delivery cannot be rejected because the customer has submitted proof of payment.' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.prevent_driver_delivery_rejection_after_proof() from public, anon, authenticated;

drop trigger if exists trg_prevent_driver_delivery_rejection_after_proof on public.deliveries;
create trigger trg_prevent_driver_delivery_rejection_after_proof
before update of driver_id, status on public.deliveries
for each row execute function public.prevent_driver_delivery_rejection_after_proof();

-- The application profile photo becomes the initial official driver photo.
-- A later photo chosen from Driver Settings is preserved on re-approval.
create or replace function public.approve_driver_application(_application_id uuid)
returns table(out_driver_id uuid, out_user_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  app_row public.driver_applications%rowtype;
  saved_driver_id uuid;
begin
  if not private.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'Only admins can approve driver applications' using errcode = '42501';
  end if;

  select * into app_row
  from public.driver_applications da
  where da.id = _application_id
  limit 1;

  if app_row.id is null then
    raise exception 'Driver application not found' using errcode = 'P0002';
  end if;

  insert into public.user_roles (user_id, role)
  values (app_row.user_id, 'driver'::public.app_role)
  on conflict (user_id, role) do nothing;

  insert into public.drivers (
    user_id, name, phone, profile_image_url, branch_id,
    bank_name, bank_account_number, bank_account_holder,
    approval_status, approved_at
  ) values (
    app_row.user_id, app_row.name, app_row.phone, app_row.profile_photo_url, app_row.branch_id,
    app_row.bank_name, app_row.bank_account_number, app_row.bank_account_holder,
    'approved', now()
  )
  on conflict (user_id) do update set
    name = excluded.name,
    phone = excluded.phone,
    profile_image_url = coalesce(public.drivers.profile_image_url, excluded.profile_image_url),
    branch_id = excluded.branch_id,
    bank_name = coalesce(excluded.bank_name, public.drivers.bank_name),
    bank_account_number = coalesce(excluded.bank_account_number, public.drivers.bank_account_number),
    bank_account_holder = coalesce(excluded.bank_account_holder, public.drivers.bank_account_holder),
    approval_status = 'approved',
    approved_at = coalesce(public.drivers.approved_at, now()),
    rejected_at = null,
    suspended_at = null,
    suspension_reason = null,
    updated_at = now()
  returning public.drivers.id into saved_driver_id;

  update public.driver_applications da
  set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), admin_notes = null, updated_at = now()
  where da.id = _application_id;

  return query select saved_driver_id, app_row.user_id;
end;
$$;
revoke all on function public.approve_driver_application(uuid) from public, anon;
grant execute on function public.approve_driver_application(uuid) to authenticated;

-- Repair approved drivers whose application photo was never copied previously.
update public.drivers d
set profile_image_url = a.profile_photo_url,
    updated_at = now()
from public.driver_applications a
where a.user_id = d.user_id
  and a.status = 'approved'
  and nullif(trim(coalesce(a.profile_photo_url, '')), '') is not null
  and nullif(trim(coalesce(d.profile_image_url, '')), '') is null;
