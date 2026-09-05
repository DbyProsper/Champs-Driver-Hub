alter table public.site_settings
  add column if not exists hero_slide_duration_seconds smallint not null default 6,
  add column if not exists hero_image_opacity smallint not null default 100;

alter table public.site_settings
  drop constraint if exists site_settings_hero_slide_duration_seconds_check,
  add constraint site_settings_hero_slide_duration_seconds_check
    check (hero_slide_duration_seconds between 2 and 30),
  drop constraint if exists site_settings_hero_image_opacity_check,
  add constraint site_settings_hero_image_opacity_check
    check (hero_image_opacity between 0 and 100);
