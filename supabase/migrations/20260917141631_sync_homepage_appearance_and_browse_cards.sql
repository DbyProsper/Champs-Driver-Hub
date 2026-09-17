alter table public.site_settings
  add column if not exists browse_menu_heading text not null default 'Browse the menu',
  add column if not exists browse_chicken_image_key text not null default 'chicken-hero',
  add column if not exists browse_chicken_title text not null default 'Chicken',
  add column if not exists browse_chicken_description text not null default '1pc → 21pc bucket',
  add column if not exists browse_combos_image_key text not null default 'chicken-chips',
  add column if not exists browse_combos_title text not null default 'Combos',
  add column if not exists browse_combos_description text not null default 'Chicken + chips',
  add column if not exists browse_burgers_image_key text not null default 'burger-card',
  add column if not exists browse_burgers_title text not null default 'Burgers',
  add column if not exists browse_burgers_description text not null default 'Mississippi, Dekka',
  add column if not exists browse_shakes_image_key text not null default 'shakes-card',
  add column if not exists browse_shakes_title text not null default 'Shakes',
  add column if not exists browse_shakes_description text not null default 'Cold & creamy';

-- Branch rows were originally copied from the global row. Bring only stale hero
-- slideshow fields forward so removed slides cannot keep appearing on homepages.
update public.site_settings as branch_settings
set
  hero_image_key = global_settings.hero_image_key,
  hero_slideshow_keys = global_settings.hero_slideshow_keys,
  hero_slide_duration_seconds = global_settings.hero_slide_duration_seconds,
  hero_image_opacity = global_settings.hero_image_opacity,
  hero_focus_x = global_settings.hero_focus_x,
  hero_focus_y = global_settings.hero_focus_y
from public.site_settings as global_settings
where global_settings.id = 'main'
  and branch_settings.branch_id is not null
  and branch_settings.updated_at < global_settings.updated_at;
