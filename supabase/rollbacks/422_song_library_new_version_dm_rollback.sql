-- Undo migration 422 (Song Library new_version DMs) in one transaction.
-- Puts back 419's kind and refs CHECKs on song_library_notifications and
-- drops the new_version unique index.
--
-- It refuses to run while any new_version claim exists (419's CHECKs would
-- reject those rows), unless the session first runs
--   SET song_library.rollback_drops_new_version = 'yes';
-- in which case it deletes them and RAISEs a NOTICE with the count (and
-- the ids when there are 50 or fewer). They are send records: once
-- deleted, a re-applied 422 could DM those people again for the same
-- versions.
-- Export before this runs. From psql:
--   \copy (SELECT * FROM public.song_library_notifications WHERE kind = 'new_version') TO 'song_library_new_version_dms.csv' CSV HEADER
-- Safe to run twice. Run before the 419 rollback.

BEGIN;

DO $guard$
DECLARE
  n bigint;
  ids uuid[];
BEGIN
  IF to_regclass('public.song_library_notifications') IS NOT NULL THEN
    EXECUTE $q$SELECT count(*) FROM public.song_library_notifications WHERE kind = 'new_version'$q$ INTO n;
    IF n > 0 THEN
      IF COALESCE(current_setting('song_library.rollback_drops_new_version', true), '') <> 'yes' THEN
        RAISE EXCEPTION '422 rollback refused: % new_version notification(s) exist. Export them, then SET song_library.rollback_drops_new_version = ''yes'' in this session to delete them.', n
          USING ERRCODE = '55000';
      END IF;
      EXECUTE $q$WITH d AS (DELETE FROM public.song_library_notifications WHERE kind = 'new_version' RETURNING id)
                 SELECT array_agg(id ORDER BY id) FROM d$q$ INTO ids;
      IF cardinality(ids) <= 50 THEN
        RAISE NOTICE '422 rollback: deleted % new_version notification(s): %', cardinality(ids), array_to_string(ids, ', ');
      ELSE
        RAISE NOTICE '422 rollback: deleted % new_version notification(s) (ids not listed, more than 50)', cardinality(ids);
      END IF;
    END IF;
  END IF;
END
$guard$;

DROP INDEX IF EXISTS public.song_library_notifications_new_version_key;

DO $checks$
BEGIN
  IF to_regclass('public.song_library_notifications') IS NOT NULL THEN
    ALTER TABLE public.song_library_notifications
      DROP CONSTRAINT IF EXISTS song_library_notifications_kind_check;
    ALTER TABLE public.song_library_notifications
      ADD CONSTRAINT song_library_notifications_kind_check
      CHECK (kind IN ('new_upload', 'stage_moved', 'help_asked'));
    ALTER TABLE public.song_library_notifications
      DROP CONSTRAINT IF EXISTS song_library_notifications_refs;
    ALTER TABLE public.song_library_notifications
      ADD CONSTRAINT song_library_notifications_refs CHECK (
        ((kind = 'stage_moved') = (stage_event_id IS NOT NULL))
        AND ((kind = 'help_asked') = (help_request_id IS NOT NULL))
      );
    COMMENT ON TABLE public.song_library_notifications IS
      'Slack DM outbox and idempotency claim: one row per person per upload / stage event / help request (INSERT ... ON CONFLICT DO NOTHING, then DM, then set slack_ts and sent_at). Service role writes; each person reads their own.';
  END IF;
END
$checks$;

COMMIT;
