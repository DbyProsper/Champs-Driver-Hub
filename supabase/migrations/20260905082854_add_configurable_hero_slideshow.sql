alter table public.site_settings
  add column if not exists hero_slideshow_keys text[] not null
  default array['girls-lunch', 'chicken-chips', 'chicken-hero', 'couple', 'champs-facebook-info']::text[];

update public.site_settings
set hero_slideshow_keys = array_prepend(
  hero_image_key,
  array_remove(
    array['girls-lunch', 'chicken-chips', 'chicken-hero', 'couple', 'champs-facebook-info']::text[],
    hero_image_key
  )
)
where id = 'main';

alter table public.site_settings
  drop constraint if exists site_settings_hero_slideshow_keys_check;

alter table public.site_settings
  add constraint site_settings_hero_slideshow_keys_check
  check (
    cardinality(hero_slideshow_keys) between 1 and 12
    and array_position(hero_slideshow_keys, null) is null
    and not ('' = any(hero_slideshow_keys))
  );

insert into public.media_assets (title, image_key, src, alt, usage, is_active, sort_order)
values (
  'Champs Facebook information',
  'champs-facebook-info',
  '/images/champs/ChampsFacebookinfo.jpg',
  'Champs Chicken information',
  'hero',
  true,
  35
)
on conflict (image_key) do update set
  title = excluded.title,
  src = excluded.src,
  alt = excluded.alt,
  usage = excluded.usage,
  is_active = true;
