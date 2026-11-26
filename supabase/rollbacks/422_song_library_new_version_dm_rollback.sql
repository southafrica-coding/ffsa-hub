-- Undo migration 422 (Song Library new_version DMs) in one transaction.
-- Puts back 419's kind and refs CHECKs on song_library_notifications and
-- drops the new_version unique index.
--
-- It refuses to run while any new_version claim exists (419's CHECKs would
-- reject those rows), unless the session first runs
--   SET song_library.rollback_drops_new_version = 'yes';
-- in which case it deletes them and RAISEs a NOTICE with the count (and
-- the ids when there are 50 or fewer; a flagged run with nothing to
-- delete reports 'deleted 0'). They are send records: once
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
  flagged boolean := COALESCE(current_setting('song_library.rollback_drops_new_version', true), '') = 'yes';
BEGIN
  IF to_regclass('public.song_library_notifications') IS NOT NULL THEN
    EXECUTE $q$SELECT count(*) FROM public.song_library_notifications WHERE kind = 'new_version'$q$ INTO n;
    IF n > 0 AND NOT flagged THEN
      RAISE EXCEPTION '422 rollback refused: % new_version notification(s) exist. Export them, then SET song_library.rollback_drops_new_version = ''yes'' in this session to delete them.', n
        USING ERRCODE = '55000';
    END IF;
    IF flagged THEN
      -- array_agg over no rows is NULL; COALESCE so 0 rows reports 0.
      EXECUTE $q$WITH d AS (DELETE FROM public.song_library_notifications WHERE kind = 'new_version' RETURNING id)
                 SELECT COALESCE(array_agg(id ORDER BY id), '{}'::uuid[]) FROM d$q$ INTO ids;
      n := cardinality(ids);
      IF n = 0 THEN
        RAISE NOTICE '422 rollback: deleted 0 new_version notification(s)';
      ELSIF n <= 50 THEN
        RAISE NOTICE '422 rollback: deleted % new_version notification(s): %', n, array_to_string(ids, ', ');
      ELSE
        RAISE NOTICE '422 rollback: deleted % new_version notification(s) (ids not listed, more than 50)', n;
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
