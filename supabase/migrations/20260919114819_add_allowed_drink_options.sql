-- Let each drink-inclusive menu item or promotion define the exact drinks a
-- customer may choose. UUID arrays keep the selection on the editable record;
-- checkout still resolves the IDs against available menu items before display.
ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS allowed_drink_option_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];

ALTER TABLE public.promotions
  ADD COLUMN IF NOT EXISTS allowed_drink_option_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];

-- Preserve the existing behaviour for previously configured specials by
-- initially allowing all currently available drinks. Admins can narrow these
-- selections in the menu and promotion editors after this migration.
WITH available_drinks AS (
  SELECT coalesce(array_agg(m.id ORDER BY m.sort_order, m.name, m.id), '{}'::uuid[]) AS ids
  FROM public.menu_items m
  JOIN public.categories c ON c.id = m.category_id
  WHERE c.slug = 'drinks'
    AND m.is_available = true
)
UPDATE public.menu_items m
SET allowed_drink_option_ids = d.ids
FROM available_drinks d
WHERE m.comes_with_drink = true
  AND cardinality(m.allowed_drink_option_ids) = 0;

WITH available_drinks AS (
  SELECT coalesce(array_agg(m.id ORDER BY m.sort_order, m.name, m.id), '{}'::uuid[]) AS ids
  FROM public.menu_items m
  JOIN public.categories c ON c.id = m.category_id
  WHERE c.slug = 'drinks'
    AND m.is_available = true
)
UPDATE public.promotions p
SET allowed_drink_option_ids = d.ids
FROM available_drinks d
WHERE p.comes_with_drink = true
  AND cardinality(p.allowed_drink_option_ids) = 0;

-- Keep generated promotion menu rows in sync with their source promotion.
UPDATE public.menu_items m
SET allowed_drink_option_ids = p.allowed_drink_option_ids
FROM public.promotions p
WHERE m.promotion_id = p.id;

ALTER TABLE public.menu_items
  DROP CONSTRAINT IF EXISTS menu_items_drink_options_required,
  ADD CONSTRAINT menu_items_drink_options_required
    CHECK (NOT comes_with_drink OR cardinality(allowed_drink_option_ids) > 0);

ALTER TABLE public.promotions
  DROP CONSTRAINT IF EXISTS promotions_drink_options_required,
  ADD CONSTRAINT promotions_drink_options_required
    CHECK (NOT comes_with_drink OR cardinality(allowed_drink_option_ids) > 0);
