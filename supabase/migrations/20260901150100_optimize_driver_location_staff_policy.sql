-- Keep the existing staff policy and avoid evaluating auth.uid() for every row.
alter policy "Staff read locations"
on public.driver_locations
using (public.is_staff((select auth.uid())));
