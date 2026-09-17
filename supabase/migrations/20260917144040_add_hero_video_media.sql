alter table public.media_assets
  add column if not exists media_type text not null default 'image',
  add column if not exists duration_seconds numeric;

alter table public.media_assets
  drop constraint if exists media_assets_media_type_check,
  drop constraint if exists media_assets_video_duration_check;

alter table public.media_assets
  add constraint media_assets_media_type_check
    check (media_type in ('image', 'video')),
  add constraint media_assets_video_duration_check
    check (
      (media_type = 'image' and duration_seconds is null)
      or
      (media_type = 'video' and duration_seconds > 0 and duration_seconds <= 15)
    );

update storage.buckets
set
  file_size_limit = 26214400,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm']
where id = 'site-assets';

insert into public.media_assets (
  title,
  image_key,
  src,
  alt,
  usage,
  media_type,
  duration_seconds,
  is_active,
  sort_order
)
values (
  'Brand reveal logo animation',
  'brand-reveal-logo-animation',
  '/images/champs/Brand_reveal_logo_animation_202609081052.mp4',
  'Animated Champs logo reveal',
  'hero-video',
  'video',
  10,
  true,
  65
)
on conflict (image_key) do update set
  title = excluded.title,
  src = excluded.src,
  alt = excluded.alt,
  usage = excluded.usage,
  media_type = excluded.media_type,
  duration_seconds = excluded.duration_seconds,
  is_active = true;

update public.site_settings
set hero_slideshow_keys = array_append(hero_slideshow_keys, 'brand-reveal-logo-animation')
where not ('brand-reveal-logo-animation' = any(hero_slideshow_keys));
