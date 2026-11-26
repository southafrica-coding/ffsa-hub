-- Undo migration 419 (Song Library) in one transaction.
-- Run on prod only with Jack's explicit OK, and only after the export
-- below. It drops every song_library_* table (with their rows), the
-- song_library_* helpers and trigger functions, the song_library_song_status
-- view, the three storage.objects policies, and the song_library
-- services row (its service_owners rows go with it, ON DELETE CASCADE).
--
-- It refuses to run while any song exists, unless the session first runs
--   SET song_library.rollback_drops_songs = 'yes';
-- Songs are what people uploaded; dropping them must be on purpose.
--
-- The 'song-library' bucket is removed only when it holds no objects.
-- Otherwise it stays (with no policies, so only the service role can
-- reach it) and a NOTICE says how many objects are left. Remove those
-- through the Storage API, then delete the bucket.
--
-- Export before this runs. From psql:
--   \copy (SELECT * FROM public.song_library_songs) TO 'song_library_songs.csv' CSV HEADER
--   \copy (SELECT * FROM public.song_library_versions) TO 'song_library_versions.csv' CSV HEADER
--   \copy (SELECT * FROM public.song_library_writers) TO 'song_library_writers.csv' CSV HEADER
--   \copy (SELECT * FROM public.song_library_publishing) TO 'song_library_publishing.csv' CSV HEADER
--   \copy (SELECT * FROM public.song_library_checkpoints) TO 'song_library_checkpoints.csv' CSV HEADER
--   \copy (SELECT * FROM public.song_library_stage_events) TO 'song_library_stage_events.csv' CSV HEADER
-- Safe to run twice.

BEGIN;

DO $guard$
DECLARE
  n bigint;
BEGIN
  IF to_regclass('public.song_library_songs') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.song_library_songs' INTO n;
    IF n > 0 AND COALESCE(current_setting('song_library.rollback_drops_songs', true), '') <> 'yes' THEN
      RAISE EXCEPTION '419 rollback refused: % song(s) exist. Export them, then SET song_library.rollback_drops_songs = ''yes'' in this session to drop them.', n
        USING ERRCODE = '55000';
    END IF;
  END IF;
END
$guard$;

DROP POLICY IF EXISTS "Song library bucket: readers read" ON storage.objects;
DROP POLICY IF EXISTS "Song library bucket: writers upload" ON storage.objects;
DROP POLICY IF EXISTS "Song library bucket: writers delete" ON storage.objects;

DO $bucket$
DECLARE
  n bigint;
BEGIN
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id = 'song-library';
  IF n = 0 THEN
    DELETE FROM storage.buckets WHERE id = 'song-library';
  ELSE
    RAISE NOTICE '419 rollback: bucket song-library kept, % object(s) still in it', n;
  END IF;
END
$bucket$;

DROP VIEW IF EXISTS public.song_library_song_status;

DROP TABLE IF EXISTS public.song_library_notifications;
DROP TABLE IF EXISTS public.song_library_help_signups;
DROP TABLE IF EXISTS public.song_library_help_requests;
DROP TABLE IF EXISTS public.song_library_helpers;
DROP TABLE IF EXISTS public.song_library_subscriptions;
DROP TABLE IF EXISTS public.song_library_stage_settings;
DROP TABLE IF EXISTS public.song_library_checkpoints;
DROP TABLE IF EXISTS public.song_library_publishing;
DROP TABLE IF EXISTS public.song_library_celebrate_notes;
DROP TABLE IF EXISTS public.song_library_share_steps;
DROP TABLE IF EXISTS public.song_library_refine_items;
DROP TABLE IF EXISTS public.song_library_stage_events;
DROP TABLE IF EXISTS public.song_library_pathway_steps;
DO $circular$
BEGIN
  IF to_regclass('public.song_library_songs') IS NOT NULL THEN
    ALTER TABLE public.song_library_songs DROP CONSTRAINT IF EXISTS song_library_songs_current_version_fkey;
  END IF;
END
$circular$;
DROP TABLE IF EXISTS public.song_library_versions;
DROP TABLE IF EXISTS public.song_library_writers;
DROP TABLE IF EXISTS public.song_library_songs;

DROP FUNCTION IF EXISTS public.song_library_storage_can_write(text);
DROP FUNCTION IF EXISTS public.song_library_storage_can_read(text);
DROP FUNCTION IF EXISTS public.song_library_storage_song_id(text);
DROP FUNCTION IF EXISTS public.song_library_writer_subscriber_count(uuid);
DROP FUNCTION IF EXISTS public.song_library_my_lead_song_ids();
DROP FUNCTION IF EXISTS public.song_library_my_song_ids();
DROP FUNCTION IF EXISTS public.song_library_can_manage();
DROP FUNCTION IF EXISTS public.song_library_can_read();
DROP FUNCTION IF EXISTS public.song_library_is_admin();
DROP FUNCTION IF EXISTS public.song_library_stamp_actor();
DROP FUNCTION IF EXISTS public.song_library_parent_immutable();
DROP FUNCTION IF EXISTS public.song_library_songs_before_insert();
DROP FUNCTION IF EXISTS public.song_library_songs_guard();
DROP FUNCTION IF EXISTS public.song_library_songs_after_insert();
DROP FUNCTION IF EXISTS public.song_library_songs_after_update();
DROP FUNCTION IF EXISTS public.song_library_versions_before();
DROP FUNCTION IF EXISTS public.song_library_versions_after_insert();
DROP FUNCTION IF EXISTS public.song_library_touch_song();
DROP FUNCTION IF EXISTS public.song_library_checkpoints_log();
DROP FUNCTION IF EXISTS public.song_library_writers_before();
DROP FUNCTION IF EXISTS public.song_library_writers_log();
DROP FUNCTION IF EXISTS public.song_library_check_splits();
DROP FUNCTION IF EXISTS public.song_library_help_requests_before();
DROP FUNCTION IF EXISTS public.song_library_help_signups_before_insert();

DELETE FROM public.services WHERE service_key = 'song_library';

COMMIT;
