-- Harden privileged RPCs inherited from the historical baseline and cover foreign keys.

alter function public.sync_order_driver_from_delivery() set search_path = public;

do $$
declare fn record;
begin
  for fn in
    select n.nspname schema_name, p.proname function_name, pg_get_function_identity_arguments(p.oid) identity_arguments
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
  loop
    execute format('revoke execute on function %I.%I(%s) from public, anon', fn.schema_name, fn.function_name, fn.identity_arguments);
  end loop;
end $$;

-- This aggregate contains no personal data and is intentionally public for checkout availability.
grant execute on function public.online_drivers_count() to anon, authenticated;

-- Trigger-only functions must never be callable through the Data API.
revoke execute on function public.notify_order_workflow() from authenticated;
revoke execute on function public.on_driver_rating_changed() from authenticated;
revoke execute on function public.on_new_chat_message() from authenticated;

-- The older application RPC was superseded by the document-aware overload.
revoke execute on function public.request_driver_application(text,text,uuid,text,text,text) from authenticated;

-- Add a covering index for every public-schema foreign key that lacks one.
do $$
declare fk record;
declare index_name text;
begin
  for fk in
    select
      ns.nspname as schema_name,
      cls.relname as table_name,
      con.conname as constraint_name,
      string_agg(quote_ident(att.attname), ', ' order by key_position.ordinality) as columns_sql
    from pg_constraint con
    join pg_class cls on cls.oid = con.conrelid
    join pg_namespace ns on ns.oid = cls.relnamespace
    cross join lateral unnest(con.conkey) with ordinality as key_position(attnum, ordinality)
    join pg_attribute att on att.attrelid = con.conrelid and att.attnum = key_position.attnum
    where con.contype = 'f' and ns.nspname = 'public'
    group by ns.nspname, cls.relname, con.conname
  loop
    index_name := left('idx_' || fk.table_name || '_' || md5(fk.constraint_name), 63);
    execute format('create index if not exists %I on %I.%I (%s)', index_name, fk.schema_name, fk.table_name, fk.columns_sql);
  end loop;
end $$;
