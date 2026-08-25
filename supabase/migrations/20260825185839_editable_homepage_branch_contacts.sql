alter table public.site_settings
  add column if not exists brand_tagline text not null default 'We love to serve.',
  add column if not exists brand_left_image_key text not null default 'couple',
  add column if not exists brand_right_image_key text not null default 'chef';

alter table public.branches
  add column if not exists email text,
  add column if not exists facebook_url text,
  add column if not exists instagram_url text;

update public.site_settings set brand_tagline=coalesce(nullif(brand_tagline,''),'We love to serve.') where id='main';
