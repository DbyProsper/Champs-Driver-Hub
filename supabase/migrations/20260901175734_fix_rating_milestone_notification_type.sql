-- Keep every notification kind introduced by earlier migrations. A later
-- rating-reminder migration accidentally omitted rating_milestone, causing
-- the AFTER INSERT rating trigger to roll back valid 4-5 star reviews.
alter table public.notifications
  drop constraint if exists notifications_type_check;

alter table public.notifications
  add constraint notifications_type_check check (type in (
    'new_message',
    'order_update',
    'driver_assigned',
    'order_ready',
    'delivery_complete',
    'driver_report',
    'complaint_update',
    'driver_status',
    'rating_request',
    'rating_milestone'
  ));
