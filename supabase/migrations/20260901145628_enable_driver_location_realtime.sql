-- Reuse the existing latest-location table for secured Postgres Changes.
-- Row-level security still determines which authenticated subscribers receive rows.
do $$
begin
  alter publication supabase_realtime add table public.driver_locations;
exception
  when duplicate_object then null;
end $$;
