-- Record which menu items and promotions include a customer-selected drink.
ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS comes_with_drink boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS promotion_id uuid REFERENCES public.promotions(id) ON DELETE CASCADE;

ALTER TABLE public.promotions
  ADD COLUMN IF NOT EXISTS comes_with_drink boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS menu_items_promotion_id_key
  ON public.menu_items (promotion_id)
  WHERE promotion_id IS NOT NULL;

-- Link existing generated promo menu rows to their source promotion. The
-- promotion id makes future title, image, price, description, and drink edits
-- propagate without relying on mutable title text.
WITH promo_links AS (
  SELECT DISTINCT ON (m.id)
    m.id AS menu_item_id,
    p.id AS promotion_id,
    p.comes_with_drink
  FROM public.menu_items m
  JOIN public.categories c ON c.id = m.category_id AND c.slug = 'promos'
  JOIN public.promotions p ON lower(btrim(p.title)) = lower(btrim(m.name))
  ORDER BY m.id, p.created_at
)
UPDATE public.menu_items m
SET promotion_id = l.promotion_id,
    comes_with_drink = l.comes_with_drink
FROM promo_links l
WHERE m.id = l.menu_item_id
  AND NOT EXISTS (
    SELECT 1 FROM public.menu_items linked
    WHERE linked.promotion_id = l.promotion_id
  );

-- Canonical menu taxonomy. These rows are idempotent so the repair is safe on
-- databases that already have one or more of these categories.
INSERT INTO public.categories (name, slug, sort_order)
VALUES
  ('Salads', 'salads', 45),
  ('Drinks', 'drinks', 90),
  ('Extras', 'extras', 100)
ON CONFLICT (slug) DO UPDATE
SET name = EXCLUDED.name,
    sort_order = EXCLUDED.sort_order;

-- Move known items by what they are, not by their previous category. This also
-- catches future variants with the same product naming convention.
UPDATE public.menu_items
SET category_id = (SELECT id FROM public.categories WHERE slug = 'salads')
WHERE name ~* '[[:<:]]salad[[:>:]]';

UPDATE public.menu_items
SET category_id = (SELECT id FROM public.categories WHERE slug = 'burgers')
WHERE name ~* '[[:<:]]burger[[:>:]]';

UPDATE public.menu_items
SET category_id = (SELECT id FROM public.categories WHERE slug = 'drinks')
WHERE (name || ' ' || coalesce(variant_label, '')) ~* '(^|[^[:alpha:]])(coke|pepsi|mountain[[:space:]]+dew|powerade|spar[[:space:]]+letta|water|juice)([^[:alpha:]]|$)';

UPDATE public.menu_items
SET category_id = (SELECT id FROM public.categories WHERE slug = 'extras')
WHERE name ~* '^buns?$';

-- Keep the visible arrow ordering deterministic after moving items.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY category_id
           ORDER BY sort_order, created_at, name, id
         ) * 10 AS repaired_sort_order
  FROM public.menu_items
)
UPDATE public.menu_items m
SET sort_order = r.repaired_sort_order
FROM ranked r
WHERE m.id = r.id
  AND m.sort_order IS DISTINCT FROM r.repaired_sort_order;
