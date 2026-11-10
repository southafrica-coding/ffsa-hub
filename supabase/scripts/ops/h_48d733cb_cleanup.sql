-- ============================================================
-- H: remove 48d733cb (Ellen Stines)'s grants that point at programs that
-- no longer exist. Data script, NOT a migration. Jack: "yes please".
-- ============================================================
-- Prod, read-only, 10 Nov 2026: 45 program-scoped grants on 5 deleted
-- program ids (b8110655, d966b7d0, 518f85c6, 8be61d2a, a311977f; granted
-- 30 Apr 2026 by 26d4b510) x 9 keys: finance.approve/edit/export/view,
-- schools.approve_applications/manage_attendance/manage_enrollments/view/
-- view_applications. (The "6 old grants" in the question was the 5 stale
-- approve_applications rows plus one; it is really 45 rows on 5 ids.)
-- A grant scoped to a program that does not exist matches no row, so
-- removing them changes nobody's access. Live-program grants, unscoped
-- grants, event grants and roles are untouched.
--
-- Run: psql -v ON_ERROR_STOP=1 -f h_48d733cb_cleanup.sql
-- verify (default) ends in RAISE EXCEPTION 'VERIFY_RESULTS {...}' = rollback.
-- commit refuses to run if the row count is not the expected 45.
-- ============================================================

SELECT set_config('h316.mode', 'verify', false);   -- SWITCH: verify (roll back, default) | commit

DO $h$
DECLARE
  v_commit boolean := coalesce(current_setting('h316.mode', true), 'verify') = 'commit';
  c_uid constant uuid := '48d733cb-7db2-4a15-86a3-51e04a64c816';
  c_expected constant int := 45;
  b jsonb; a jsonb; n int; res jsonb;
BEGIN
  SELECT jsonb_build_object(
    'total', count(*),
    'scoped_program_live', count(*) FILTER (WHERE up.scope_type = 'program' AND pg.id IS NOT NULL),
    'scoped_program_stale', count(*) FILTER (WHERE up.scope_type = 'program' AND pg.id IS NULL),
    'scoped_event', count(*) FILTER (WHERE up.scope_type = 'event'),
    'unscoped', count(*) FILTER (WHERE up.scope_type IS NULL))
  INTO b
  FROM public.user_permissions up LEFT JOIN public.programs pg ON pg.id = up.scope_id
  WHERE up.user_id = c_uid;

  DELETE FROM public.user_permissions up
   WHERE up.user_id = c_uid
     AND up.scope_type = 'program'
     AND NOT EXISTS (SELECT 1 FROM public.programs pg WHERE pg.id = up.scope_id);
  GET DIAGNOSTICS n = ROW_COUNT;

  SELECT jsonb_build_object(
    'total', count(*),
    'scoped_program_live', count(*) FILTER (WHERE up.scope_type = 'program' AND pg.id IS NOT NULL),
    'scoped_program_stale', count(*) FILTER (WHERE up.scope_type = 'program' AND pg.id IS NULL),
    'scoped_event', count(*) FILTER (WHERE up.scope_type = 'event'),
    'unscoped', count(*) FILTER (WHERE up.scope_type IS NULL))
  INTO a
  FROM public.user_permissions up LEFT JOIN public.programs pg ON pg.id = up.scope_id
  WHERE up.user_id = c_uid;

  res := jsonb_build_object('mode', CASE WHEN v_commit THEN 'commit' ELSE 'verify' END,
                            'deleted', n, 'before', b, 'after', a);
  IF NOT v_commit THEN
    RAISE EXCEPTION 'VERIFY_RESULTS %', res;
  END IF;
  IF n <> c_expected THEN
    RAISE EXCEPTION 'H aborted: expected % stale rows, found %. Nothing changed. %', c_expected, n, res;
  END IF;
  RAISE NOTICE 'H_COMMITTED %', res;
END
$h$;
