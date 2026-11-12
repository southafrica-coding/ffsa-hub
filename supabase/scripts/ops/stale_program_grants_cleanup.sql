-- ============================================================
-- Stale scoped grants cleanup (H, extended in round 2). Data script, NOT
-- a migration. Replaces h_48d733cb_cleanup.sql.
-- ============================================================
-- Deletes user_permissions rows whose scope points at a program that no
-- longer exists, for three people (prod, read-only, 10 Nov 2026):
--   48d733cb Ellen Stines   45 rows on 5 deleted programs (b8110655,
--            d966b7d0, 518f85c6, 8be61d2a, a311977f), granted 30 Apr 2026
--   68f5d637 (super_admin)  10 rows on deleted program a311977f
--   62d623b0                 9 rows on deleted program a311977f
-- 68f5d637 also has 4 grants scoped to a deleted EVENT (2a80fbbe); with
-- those the total is 14. They are removed by default (SWITCH 2 on, per Jack).
-- Nothing else is touched: grants on live programs or events, unscoped
-- grants, team scopes, roles.
--
-- Proof of no loss: for each person, before and after the delete, the
-- script evaluates as that person every catalog key with
--   has_permission(key), has_permission_for(key, NULL),
--   has_permission_for(key, p) for every existing program p, and
--   has_event_permission(key, e) for every existing event e (if 314 is in).
-- Any difference aborts (both modes) and lists what would change.
--
-- Run: psql -v ON_ERROR_STOP=1 -f stale_program_grants_cleanup.sql
-- verify (default) ends in RAISE EXCEPTION 'VERIFY_RESULTS {...}' = rollback.
-- commit requires the exact per-person counts and no access change.
-- ============================================================

SELECT set_config('stale316.mode', 'verify', false);               -- SWITCH 1: verify (roll back, default) | commit
SELECT set_config('stale316.include_dead_events', 'true', false);  -- SWITCH 2: true = also deleted-event grants (default) | false = programs only

DO $s$
DECLARE
  v_commit boolean := coalesce(current_setting('stale316.mode', true), 'verify') = 'commit';
  v_events boolean := coalesce(nullif(current_setting('stale316.include_dead_events', true), ''), 'true')::boolean;
  c_people constant jsonb := jsonb_build_object(
    '48d733cb-7db2-4a15-86a3-51e04a64c816', jsonb_build_object('program', 45, 'event', 0),
    '68f5d637-afde-409e-abed-eaee20df19a7', jsonb_build_object('program', 10, 'event', 4),
    '62d623b0-05dd-4e27-ab22-73619e231b30', jsonb_build_object('program', 9,  'event', 0));
  has_ev boolean := to_regprocedure('public.has_event_permission(text, uuid)') IS NOT NULL;
  u text; k int; n_p int; n_e int; keys text[]; pids uuid[]; eids uuid[]; ky text; i int;
  snap jsonb; before_s jsonb := '{}'; after_s jsonb := '{}'; lost jsonb := '{}'; gained jsonb := '{}';
  cnt jsonb := '{}'; rows jsonb; res jsonb; bad boolean := false; exp_n int; exp_e int; bv boolean;
BEGIN
  SELECT array_agg(key ORDER BY key) INTO keys FROM public.permissions;
  SELECT array_agg(id) INTO pids FROM public.programs;
  SELECT array_agg(id) INTO eids FROM public.events
   WHERE id IN (SELECT scope_id FROM public.user_permissions WHERE scope_type = 'event'
                  AND user_id IN (SELECT x::uuid FROM jsonb_object_keys(c_people) x));  -- only events these people hold grants on can change

  FOR k IN 1..2 LOOP
    IF k = 2 THEN
      FOR u IN SELECT jsonb_object_keys(c_people) LOOP
        WITH d AS (
          DELETE FROM public.user_permissions up
           WHERE up.user_id = u::uuid AND up.scope_type = 'program'
             AND NOT EXISTS (SELECT 1 FROM public.programs pg WHERE pg.id = up.scope_id)
          RETURNING up.permission_id, up.scope_id)
        SELECT coalesce(sum(nn), 0)::int, coalesce(jsonb_object_agg(kk, nn), '{}') INTO n_p, rows FROM (
          SELECT p.key kk, count(*) nn FROM d JOIN public.permissions p ON p.id = d.permission_id GROUP BY 1) z;
        n_e := 0;
        IF v_events THEN
          DELETE FROM public.user_permissions up
           WHERE up.user_id = u::uuid AND up.scope_type = 'event'
             AND NOT EXISTS (SELECT 1 FROM public.events ev WHERE ev.id = up.scope_id);
          GET DIAGNOSTICS n_e = ROW_COUNT;
        END IF;
        cnt := cnt || jsonb_build_object(left(u, 8), jsonb_build_object('deleted_program', n_p, 'deleted_event', n_e, 'by_key', rows));
      END LOOP;
    END IF;

    -- effective access snapshot, as each person
    FOR u IN SELECT jsonb_object_keys(c_people) LOOP
      PERFORM set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
      PERFORM set_config('request.jwt.claim.sub', u, true);
      EXECUTE 'SET LOCAL ROLE authenticated';
      snap := '[]';
      FOREACH ky IN ARRAY keys LOOP
        IF public.has_permission(ky) THEN snap := snap || to_jsonb(ky || ' any'); END IF;
        IF public.has_permission_for(ky, NULL::uuid) THEN snap := snap || to_jsonb(ky || ' org-wide'); END IF;
        FOR i IN 1..coalesce(array_length(pids, 1), 0) LOOP
          IF public.has_permission_for(ky, pids[i]) THEN snap := snap || to_jsonb(ky || ' program ' || pids[i]); END IF;
        END LOOP;
        IF has_ev THEN
          FOR i IN 1..coalesce(array_length(eids, 1), 0) LOOP
            EXECUTE 'SELECT public.has_event_permission($1, $2)' INTO bv USING ky, eids[i];
            IF bv THEN snap := snap || to_jsonb(ky || ' event ' || eids[i]); END IF;
          END LOOP;
        END IF;
      END LOOP;
      snap := to_jsonb(array(SELECT jsonb_array_elements_text(snap) ORDER BY 1)) ||
              jsonb_build_array('is_admin=' || public.is_admin(), 'has_schools_access=' || public.has_schools_access());
      EXECUTE 'RESET ROLE';
      IF k = 1 THEN before_s := before_s || jsonb_build_object(left(u, 8), snap);
      ELSE after_s := after_s || jsonb_build_object(left(u, 8), snap); END IF;
    END LOOP;
    PERFORM set_config('request.jwt.claims', '', true);
    PERFORM set_config('request.jwt.claim.sub', '', true);
  END LOOP;

  FOR u IN SELECT jsonb_object_keys(before_s) LOOP
    lost := lost || jsonb_build_object(u, to_jsonb(array(SELECT jsonb_array_elements_text(before_s->u) EXCEPT SELECT jsonb_array_elements_text(after_s->u))));
    gained := gained || jsonb_build_object(u, to_jsonb(array(SELECT jsonb_array_elements_text(after_s->u) EXCEPT SELECT jsonb_array_elements_text(before_s->u))));
    IF jsonb_array_length(lost->u) > 0 OR jsonb_array_length(gained->u) > 0 THEN bad := true; END IF;
  END LOOP;

  res := jsonb_build_object('mode', CASE WHEN v_commit THEN 'commit' ELSE 'verify' END, 'include_dead_events', v_events,
    'counts', cnt, 'access_checks_per_person', (SELECT jsonb_object_agg(x, jsonb_array_length(before_s->x)) FROM jsonb_object_keys(before_s) x),
    'access_lost', lost, 'access_gained', gained, 'access_unchanged', NOT bad);
  IF bad THEN
    RAISE EXCEPTION 'STALE_ABORTED effective access would change. Nothing changed. %', res;
  END IF;
  IF NOT v_commit THEN
    RAISE EXCEPTION 'VERIFY_RESULTS %', res;
  END IF;
  FOR u IN SELECT jsonb_object_keys(c_people) LOOP
    exp_n := (c_people->u->>'program')::int;
    exp_e := CASE WHEN v_events THEN (c_people->u->>'event')::int ELSE 0 END;
    IF (cnt->left(u, 8)->>'deleted_program')::int <> exp_n OR (cnt->left(u, 8)->>'deleted_event')::int <> exp_e THEN
      RAISE EXCEPTION 'STALE_ABORTED %: deleted % program / % event rows, expected % / %. Nothing changed. %',
        left(u, 8), cnt->left(u, 8)->>'deleted_program', cnt->left(u, 8)->>'deleted_event', exp_n, exp_e, res;
    END IF;
  END LOOP;
  RAISE NOTICE 'STALE_COMMITTED %', res;
END
$s$;
