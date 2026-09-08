-- Branch-specific admin configuration while preserving the existing global defaults.
alter table public.delivery_settings
  add column if not exists branch_id uuid references public.branches(id) on delete cascade;

create unique index if not exists delivery_settings_branch_id_key
  on public.delivery_settings (branch_id) where branch_id is not null;

insert into public.delivery_settings (
  id, max_radius_km, tier1_max_km, tier1_fee_cents, tier2_max_km, tier2_fee_cents,
  tier3_max_km, tier3_fee_cents, base_prep_min, avg_stop_min, peak_threshold,
  max_wait_min, normal_capacity_min, normal_capacity_max, peak_capacity_min,
  peak_capacity_max, manual_peak_mode, delivery_enabled, drivers_dial_up_only,
  pickup_enabled, auto_ready_mode, branch_id
)
select
  'branch:' || b.id::text, d.max_radius_km, d.tier1_max_km, d.tier1_fee_cents,
  d.tier2_max_km, d.tier2_fee_cents, d.tier3_max_km, d.tier3_fee_cents,
  d.base_prep_min, d.avg_stop_min, d.peak_threshold, d.max_wait_min,
  d.normal_capacity_min, d.normal_capacity_max, d.peak_capacity_min,
  d.peak_capacity_max, d.manual_peak_mode, d.delivery_enabled,
  d.drivers_dial_up_only, d.pickup_enabled, d.auto_ready_mode, b.id
from public.branches b
cross join public.delivery_settings d
where d.id = 'default'
on conflict (id) do nothing;

alter table public.site_settings drop constraint if exists site_settings_singleton;
alter table public.site_settings
  add column if not exists branch_id uuid references public.branches(id) on delete cascade;

create unique index if not exists site_settings_branch_id_key
  on public.site_settings (branch_id) where branch_id is not null;

insert into public.site_settings (
  id, hero_eyebrow, hero_line_one, hero_line_two, hero_body, hero_image_key,
  hero_focus_x, hero_focus_y, primary_cta_label, secondary_cta_label, theme,
  show_promotions, show_categories, show_brand_strip, show_branch_info,
  brand_tagline, brand_left_image_key, brand_right_image_key,
  online_ordering_open, online_ordering_closed_message, hero_slideshow_keys,
  hero_slide_duration_seconds, hero_image_opacity, branch_id
)
select
  'branch:' || b.id::text, s.hero_eyebrow, s.hero_line_one, s.hero_line_two,
  s.hero_body, s.hero_image_key, s.hero_focus_x, s.hero_focus_y,
  s.primary_cta_label, s.secondary_cta_label, s.theme, s.show_promotions,
  s.show_categories, s.show_brand_strip, s.show_branch_info, s.brand_tagline,
  s.brand_left_image_key, s.brand_right_image_key, s.online_ordering_open,
  s.online_ordering_closed_message, s.hero_slideshow_keys,
  s.hero_slide_duration_seconds, s.hero_image_opacity, b.id
from public.branches b
cross join public.site_settings s
where s.id = 'main'
on conflict (id) do nothing;

alter table public.menu_items
  add column if not exists branch_id uuid references public.branches(id) on delete cascade;

create index if not exists menu_items_branch_category_sort_idx
  on public.menu_items (branch_id, category_id, sort_order);

alter table public.promotions
  add column if not exists is_recurring boolean not null default false;

-- Existing editor values were stored as UTC clock values even though admins entered
-- South Africa local time. Shift them once so 00:00 remains 00:00 in Johannesburg.
update public.promotions
set active_from = active_from - interval '2 hours',
    active_until = active_until - interval '2 hours'
where active_from is not null or active_until is not null;

update public.promotions
set is_recurring = true,
    active_until = null
where day_of_week is not null
  and lower(coalesce(title, '')) like '%special%';

alter table public.promotions drop constraint if exists promotions_recurring_day_check;
alter table public.promotions
  add constraint promotions_recurring_day_check
  check (not is_recurring or day_of_week between 0 and 6);

create or replace function public.normalize_recurring_promotion()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.is_recurring then
    new.active_until := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_normalize_recurring_promotion on public.promotions;
create trigger trg_normalize_recurring_promotion
before insert or update of is_recurring, active_until on public.promotions
for each row execute function public.normalize_recurring_promotion();
