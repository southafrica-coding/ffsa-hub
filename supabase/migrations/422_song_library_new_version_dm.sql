-- 422: Song Library DMs for each new version (v2 onward).
--
-- Adds kind 'new_version' to song_library_notifications (the DM outbox /
-- idempotency claim the service role writes), for #748's "new version"
-- DMs. A new_version claim points at the stage_events row that
-- song_library_versions_after_insert (419) writes for every version
-- upload: kind 'version', payload { version_id, n, label, is_demo },
-- by_user = the uploader. v1 is covered by new_upload, so the sender
-- skips payload n = 1.
--
--   kind CHECK  + 'new_version'
--   refs CHECK  stage_event_id is set exactly for stage_moved and
--               new_version; help_request_id exactly for help_asked
--               (the other kinds' rules are unchanged)
--   unique      (user_id, stage_event_id) WHERE kind = 'new_version'
--
-- No RLS, grant, helper or publishing changes. Both CHECKs are dropped and
-- re-added by name, and the index is IF NOT EXISTS, so the file is safe to
-- run twice. Rollback: supabase/rollbacks/422_song_library_new_version_dm_rollback.sql

BEGIN;

ALTER TABLE public.song_library_notifications
  DROP CONSTRAINT IF EXISTS song_library_notifications_kind_check;
ALTER TABLE public.song_library_notifications
  ADD CONSTRAINT song_library_notifications_kind_check
  CHECK (kind IN ('new_upload', 'stage_moved', 'help_asked', 'new_version'));

ALTER TABLE public.song_library_notifications
  DROP CONSTRAINT IF EXISTS song_library_notifications_refs;
ALTER TABLE public.song_library_notifications
  ADD CONSTRAINT song_library_notifications_refs CHECK (
    ((kind IN ('stage_moved', 'new_version')) = (stage_event_id IS NOT NULL))
    AND ((kind = 'help_asked') = (help_request_id IS NOT NULL))
  );

CREATE UNIQUE INDEX IF NOT EXISTS song_library_notifications_new_version_key
  ON public.song_library_notifications (user_id, stage_event_id) WHERE kind = 'new_version';

COMMENT ON TABLE public.song_library_notifications IS
  'Slack DM outbox and idempotency claim: one row per person per upload / new version (its version stage event, v2 onward) / stage event / help request (INSERT ... ON CONFLICT DO NOTHING, then DM, then set slack_ts and sent_at). Service role writes; each person reads their own.';

COMMIT;
