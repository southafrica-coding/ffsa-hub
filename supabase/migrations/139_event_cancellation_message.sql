-- 139_event_cancellation_message.sql
-- Adds an optional cancellation message per event, shown to ticket holders
-- (refund email + public event page) and stored as the admin record of why
-- an event was cancelled.

alter table public.events
  add column if not exists cancellation_message text;

comment on column public.events.cancellation_message is
  'Optional message explaining why the event was cancelled. Included in ticket refund emails and shown on the public event page when status = cancelled.';
