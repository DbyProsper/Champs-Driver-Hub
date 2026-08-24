update public.menu_items set burger_only_price_cents = 4590
where lower(name) in ('mississippi burger meal', 'double stack cheese meal');

update public.menu_items set burger_only_price_cents = 5590
where lower(name) = 'double dekka meal';
