-- ============================================================
-- FFSA Hub — Migration 405: Maintenance requests from the Hub
-- ============================================================
-- Gideon, 26 Nov 2026 (docs/operations-plan.md, "Maintenance").
-- The Slack Workflow form is replaced by a form the Hub owns, opened from
-- a "New maintenance request" button the Hub bot posts in Slack:
--
--   • every time, the rules come first on their own screen; "I agree" sits
--     under the last one, and only then does the form open
--   • what's wrong, where, how urgent, up to 3 photos
--   • outside the crew's hours (Mon–Thu 08:00–16:00, Fri 08:00–15:00, from
--     Mache's base orientation) the form and the confirmation say when the
--     crew works and when it will be handled (today, tomorrow or Monday)
--   • the Hub posts the request to #maintenance-request-submissions, with a
--     plain-text copy in the thread to paste into the crew's WhatsApp
--   • 07:00 Mon–Fri: active requests and their age in a follow-up channel;
--     the people listed here set Not started / In progress / Finished
--
-- Statuses are unchanged in the database: for maintenance, Not started is
-- 'new' (or 'seen'), In progress is 'in_progress' (or 'more_time'),
-- Finished is 'done'. Finished requests stay, for the monthly report.
--
-- Needs 400. Nothing here is granted to anyone; RLS on both tables is 401's.
--
-- ROLLBACK:
--   ALTER TABLE public.ops_items DROP COLUMN IF EXISTS urgency,
--     DROP COLUMN IF EXISTS photo_count, DROP COLUMN IF EXISTS out_of_hours;
--   ALTER TABLE public.ops_settings
--     DROP COLUMN IF EXISTS maintenance_button_channel, DROP COLUMN IF EXISTS maintenance_button_ts,
--     DROP COLUMN IF EXISTS maintenance_followup_channel, DROP COLUMN IF EXISTS maintenance_status_user_ids,
--     DROP COLUMN IF EXISTS maintenance_rules, DROP COLUMN IF EXISTS maintenance_hours_notice,
--     DROP COLUMN IF EXISTS maintenance_hours;
--   (and put the ops_digest_log kind check back to morning/weekly/recap)
-- ============================================================

-- ── 1. A request's extra answers ────────────────────────────
ALTER TABLE public.ops_items
  ADD COLUMN IF NOT EXISTS urgency      text,
  ADD COLUMN IF NOT EXISTS photo_count  smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS out_of_hours boolean NOT NULL DEFAULT false;

DO $$ BEGIN
  ALTER TABLE public.ops_items ADD CONSTRAINT ops_items_urgency
    CHECK (urgency IS NULL OR urgency IN ('urgent', 'this_week', 'when_you_can'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The monthly report reads maintenance by when it came in and when it closed.
CREATE INDEX IF NOT EXISTS ops_items_area_created
  ON public.ops_items (area, created_at);

-- ── 2. Settings ─────────────────────────────────────────────
-- maintenance_hours: the crew's working hours, SAST, by weekday
-- (0 = Sunday … 6 = Saturday). A day that isn't listed is closed.
-- {when} in the notice becomes "later today at 08:00", "first thing
-- tomorrow" or "first thing on Monday".
ALTER TABLE public.ops_settings
  ADD COLUMN IF NOT EXISTS maintenance_button_channel   text,     -- where the request button is posted
  ADD COLUMN IF NOT EXISTS maintenance_button_ts        text,     -- the button message, to replace it
  ADD COLUMN IF NOT EXISTS maintenance_followup_channel text,     -- the 07:00 follow-up
  ADD COLUMN IF NOT EXISTS maintenance_status_user_ids  uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS maintenance_rules            text,
  ADD COLUMN IF NOT EXISTS maintenance_hours_notice     text NOT NULL DEFAULT
    'Working hours for our Maintenance Crew are Monday to Thursday 08:00–16:00 and Friday 08:00–15:00. Your request will be handled {when}.',
  ADD COLUMN IF NOT EXISTS maintenance_hours            jsonb NOT NULL DEFAULT
    '{"1":{"open":"08:00","close":"16:00"},"2":{"open":"08:00","close":"16:00"},"3":{"open":"08:00","close":"16:00"},"4":{"open":"08:00","close":"16:00"},"5":{"open":"08:00","close":"15:00"}}'::jsonb;

DO $$ BEGIN
  ALTER TABLE public.ops_settings ADD CONSTRAINT ops_settings_hours_object
    CHECK (jsonb_typeof(maintenance_hours) = 'object');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.ops_settings ADD CONSTRAINT ops_settings_text_len
    CHECK (char_length(coalesce(maintenance_rules, '')) <= 2500
       AND char_length(maintenance_hours_notice) BETWEEN 1 AND 500);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The guidelines and rules from Mache's "FFSA Base Orientation / Culture /
-- Rules (Schools)" (25 Nov 2026): "Special request from our Maintenance
-- Crew" and "Maintenance Requests". Shown on their own screen every time
-- someone starts a request, with "I agree" under the last one. Slack mrkdwn;
-- a blank line starts a new block. Editable in the Hub.
UPDATE public.ops_settings
   SET maintenance_rules = E'*Special request from our Maintenance Crew*\n\nPlease don''t tamper with or adjust any appliances or resources on Base, including geysers, their temperature settings or any other equipment.\n\nIf something is broken, not working properly or needs attention, please send a maintenance request and let the Maintenance Crew know. They are trained to assess and handle these issues safely and correctly.\n\nThe appliances and resources on Base belong to the Base and are shared. We want to look after them well. When in doubt, report it rather than trying to fix or adjust it yourself.\n\n*Maintenance requests*\n\n• *Crew hours:* Monday–Thursday 08:00–16:00, Friday 08:00–15:00.\n\n• *After hours:* you''re welcome to send a request after hours, but it will only be attended to on the next working day.\n\n• *Weekends:* requests sent over the weekend are attended to on Monday.\n\n• *Emergencies:* tell your School Leader as soon as possible. Your School Leader will let HE Steyn know.\n\n• *Room requests:* please don''t have every roommate send the same request. Choose one person in the room to send it and follow it up.\n\n• *Room access:* the crew may need to go into your room. If you won''t be there, arrange for someone to let them in.'
 WHERE id AND maintenance_rules IS NULL;

-- ── 3. The follow-up is logged like the other messages ──────
ALTER TABLE public.ops_digest_log DROP CONSTRAINT IF EXISTS ops_digest_log_kind_check;
ALTER TABLE public.ops_digest_log ADD CONSTRAINT ops_digest_log_kind_check
  CHECK (kind IN ('morning', 'weekly', 'recap', 'followup'));
