-- ============================================================
-- 165_event_attendance_view.sql
-- Per-event headcount for the Events screen's capacity column.
--
-- WHY A VIEW: counting by selecting rows and tallying them in JS is capped
-- by the API's max-rows setting (1000 by default), which silently UNDERCOUNTS
-- any event past that many tickets — a wrong number, shown confidently. This
-- aggregates in Postgres, so one read returns exact counts for every event.
--
-- security_invoker = true: the view runs as the CALLER, so the existing RLS on
-- tickets / event_registrations still decides what each user may count. Without
-- it a view runs with owner rights and would leak counts to anyone.
-- (PG15+, which Supabase runs.)
--
-- Reads only. Creates no table, drops no data.
-- ============================================================

DROP VIEW IF EXISTS public.v_event_attendance;

CREATE VIEW public.v_event_attendance
WITH (security_invoker = true) AS
SELECT
  e.id AS event_id,
  -- Any ticket row at all — including voided — means the event is ticketed.
  -- That distinction decides WHICH number we report, so it must survive
  -- an event whose tickets were all refunded.
  (SELECT count(*)::int FROM public.tickets t
     WHERE t.event_id = e.id)                              AS ticket_rows,
  -- The headcount for a ticketed event: seats that are, or were, good at
  -- the door. Matches listAttendanceTicketsByEvent in services/ticketing.ts.
  (SELECT count(*)::int FROM public.tickets t
     WHERE t.event_id = e.id
       AND t.status IN ('valid', 'checked_in'))            AS ticket_attending,
  -- The headcount for a non-ticketed event. Matches getRegistrationCount in
  -- services/registrations.ts: everything except cancelled.
  (SELECT count(*)::int FROM public.event_registrations r
     WHERE r.event_id = e.id
       AND r.status <> 'cancelled')                        AS registrations_active
FROM public.events e;

GRANT SELECT ON public.v_event_attendance TO authenticated;
GRANT SELECT ON public.v_event_attendance TO service_role;

COMMENT ON VIEW public.v_event_attendance IS
  'Exact per-event headcounts for the Events capacity column. Ticketed events '
  '(ticket_rows > 0) report ticket_attending; everything else reports '
  'registrations_active. The two are never summed — ticket buyers also get an '
  'event_registrations row (lib/ticketing/crm-resolution.ts), so adding them '
  'would double-count the same person.';

-- Verify after applying:
--   select * from public.v_event_attendance limit 5;
--   select reloptions from pg_class where relname = 'v_event_attendance';
--     -> expect {security_invoker=true}
