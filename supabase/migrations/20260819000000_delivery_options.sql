ALTER TABLE public.delivery_settings
  ADD COLUMN IF NOT EXISTS delivery_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS drivers_dial_up_only boolean NOT NULL DEFAULT false;

GRANT SELECT, UPDATE ON public.delivery_settings TO authenticated;
GRANT ALL ON public.delivery_settings TO service_role;