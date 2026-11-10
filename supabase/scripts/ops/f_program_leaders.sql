-- ============================================================
-- F: program leaders back to their own programs (Jack, 10 Nov 2026,
-- round 2). Data script, NOT a migration.
-- ============================================================
-- People (prod, read-only, 10 Nov 2026):
--   41763eb6 Makaio McDowell -> own program FFBX September 2026 (5256f736)
--       program_leader role scoped to it, program_leaders row, created it.
--   542986ea Enge Swart      -> own programs Leadership Track Q4/2026
--       (2783427b; program_leader role scoped to it) and Fire & Fragrance
--       SA Experience 2027 (f839fd44; Jack: keep Enge's SA Exp grants).
--
-- Per person (Jack's answers):
--   1. Delete every UNSCOPED schools.* grant (except schools.templates.manage).
--      On prod: schools.view, view_applications, approve_applications,
--      manage_enrollments, manage_attendance, manage = 6 rows each.
--   2. Ensure each deleted key exists scoped to each own program; insert
--      only where missing (0 on prod: the scoped copies already exist).
--   3. Makaio only: delete all his schools.* grants scoped to SA Experience
--      2027 (7 rows on prod). Enge keeps hers.
--   4. Grant schools.templates.manage UNSCOPED to both (template library
--      writes; needs migration 316, which seeds the key). 1 row each.
--   5. Enge: program_leaders row for Leadership Track Q4/2026, same columns
--      as Makaio's FFBX row (program_id, user_id, added_by copied from his
--      row). Idempotent (UNIQUE (program_id, user_id)). 1 row.
--   6. Makaio only (Jack, 10 Nov 09:33 SAST: LIMIT): delete his UNSCOPED
--      finance.approve, finance.edit, finance.export (3 rows on prod). His
--      unscoped finance.view stays.
--   7. Makaio only: ensure finance.approve, edit, export, view scoped to his
--      own program (FFBX); insert only where missing (3 on prod: view @ FFBX
--      already exists). Same shape as the other three program finance users
--      on prod (08c957a0, c380c569 @ LTQ4; 666e334c @ FFBX): those four keys
--      scoped to the program plus one unscoped finance.view. With 316 the
--      scoped rows count only in has_permission_for(key, program).
--   Not touched: roles (both keep program_leader scoped to their program),
--   non-schools / non-finance keys, Enge's finance (she has none).
--
-- ORDER: after 313 and 316, and after 310 or 312. Commit mode refuses to
-- run otherwise. Verify mode runs anywhere and reports the preconditions;
-- if 316's key row is missing it adds it inside the rolled-back
-- transaction so the preview is complete.
--
-- Run:  psql -v ON_ERROR_STOP=1 -f f_program_leaders.sql
-- verify mode (default) always ends in RAISE EXCEPTION 'VERIFY_RESULTS
-- {...}' so everything rolls back; the JSON has row counts per person and
-- key, grants and effective access per capability before and after
-- (schools.* and finance.* per program via has_permission_for, finance
-- org-wide via has_permission).
-- commit mode requires the EXACT counts in c_expected below (per person:
-- deletes, inserts, program_leaders rows) and aborts with no change on any
-- difference, including a second run.
-- ============================================================

SELECT set_config('f316.mode', 'verify', false);   -- SWITCH: verify (roll back, default) | commit

DO $f$
DECLARE
  v_commit boolean := coalesce(current_setting('f316.mode', true), 'verify') = 'commit';
  c_mak  constant uuid := '41763eb6-23e3-4837-93c3-7e568be8dc29';
  c_enge constant uuid := '542986ea-5b7f-481a-86c9-2061d0d2fc8a';
  c_ffbx constant uuid := '5256f736-2eaa-49df-909e-0dd3de48fe4f';
  c_lt   constant uuid := '2783427b-de98-4620-b7f4-7defd51010ef';
  c_sa   constant uuid := 'f839fd44-0051-4d47-ab8d-b548c5d32648';
  c_tm   constant text := 'schools.templates.manage';
  -- per person: own programs, programs whose scoped schools.* grants go,
  -- unscoped finance.* keys to delete, finance.* keys to hold per own program
  plan jsonb := jsonb_build_object(
    c_mak::text,  jsonb_build_object('name', 'Makaio', 'own', jsonb_build_array(c_ffbx), 'drop_scoped', jsonb_build_array(c_sa),
                    'fin_drop_unscoped', jsonb_build_array('finance.approve', 'finance.edit', 'finance.export'),
                    'fin_scoped', jsonb_build_array('finance.approve', 'finance.edit', 'finance.export', 'finance.view')),
    c_enge::text, jsonb_build_object('name', 'Enge',   'own', jsonb_build_array(c_lt, c_sa), 'drop_scoped', jsonb_build_array(),
                    'fin_drop_unscoped', jsonb_build_array(), 'fin_scoped', jsonb_build_array()));
  -- exact expected row counts for commit mode (prod, 10 Nov 2026)
  c_expected constant jsonb := jsonb_build_object(
    'Makaio', jsonb_build_object('del_unscoped', 6, 'del_dropped_program', 7, 'ins_scoped', 0, 'ins_templates_manage', 1, 'ins_program_leaders', 0,
                                 'del_finance_unscoped', 3, 'ins_finance_scoped', 3),
    'Enge',   jsonb_build_object('del_unscoped', 6, 'del_dropped_program', 0, 'ins_scoped', 0, 'ins_templates_manage', 1, 'ins_program_leaders', 1,
                                 'del_finance_unscoped', 0, 'ins_finance_scoped', 0));
  has_313 boolean; has_316 boolean; has_310 boolean; has_312 boolean; seeded_key boolean := false;
  u text; nm text; i int; k int; n int; pids uuid[]; pnames text[]; b boolean;
  caps text[] := ARRAY['schools.view','schools.view_applications','schools.approve_applications','schools.manage_enrollments',
                       'schools.manage_attendance','schools.manage','schools.assignable_as_contact',
                       'finance.view','finance.edit','finance.approve','finance.export'];
  cap text; lst text[]; acc jsonb; m jsonb; g jsonb; w boolean;
  before_g jsonb := '{}'; after_g jsonb := '{}'; before_a jsonb := '{}'; after_a jsonb := '{}';
  cnt jsonb := '{}'; c jsonb; rows jsonb; res jsonb;
BEGIN
  has_313 := pg_catalog.strpos(coalesce((SELECT prosrc FROM pg_catalog.pg_proc WHERE oid = to_regprocedure('public.has_permission_for(text, uuid)')), ''), 'is_active IS NOT FALSE') > 0;
  has_316 := to_regprocedure('public.can_manage_application_templates()') IS NOT NULL
             AND EXISTS (SELECT 1 FROM public.permissions WHERE key = c_tm);
  has_310 := to_regprocedure('public.lms_can_grade(uuid)') IS NOT NULL;
  has_312 := pg_catalog.strpos(coalesce((SELECT prosrc FROM pg_catalog.pg_proc WHERE oid = to_regprocedure('public.can_manage_program_applications(uuid)')), ''), 'ur.scope_id = target_program_id') > 0;
  IF v_commit AND NOT (has_313 AND has_316 AND (has_310 OR has_312)) THEN
    RAISE EXCEPTION 'F aborted: needs 313, 316 and (310 or 312); found 313=% 316=% 310=% 312=%. Nothing changed.', has_313, has_316, has_310, has_312;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.permissions WHERE key = c_tm) THEN   -- verify-only preview before 316
    INSERT INTO public.permissions (module, key, display_name, sort_order) VALUES ('schools', c_tm, 'Manage Application Templates (org-wide only)', 6);
    seeded_key := true;
  END IF;

  SELECT array_agg(id ORDER BY name), array_agg(name ORDER BY name) INTO pids, pnames FROM public.programs;  -- as owner, before any role switch

  FOR k IN 1..2 LOOP
    IF k = 2 THEN
      -- ── the change, per person ──
      FOR u IN SELECT jsonb_object_keys(plan) LOOP
        nm := plan->u->>'name'; c := '{}';
        -- 1. unscoped schools.* (not the org-wide-only templates key)
        WITH d AS (
          DELETE FROM public.user_permissions up USING public.permissions p
           WHERE p.id = up.permission_id AND up.user_id = u::uuid AND up.scope_type IS NULL
             AND p.key LIKE 'schools.%' AND p.key <> c_tm
          RETURNING p.key)
        SELECT count(*), coalesce(jsonb_agg(key ORDER BY key), '[]') INTO n, rows FROM d;
        c := c || jsonb_build_object('del_unscoped', n, 'del_unscoped_keys', rows);
        -- 2. scoped copy per own program where missing (keys from step 1)
        WITH ins AS (
          INSERT INTO public.user_permissions (user_id, permission_id, scope_type, scope_id)
          SELECT u::uuid, p.id, 'program', o.pid
            FROM jsonb_array_elements_text(rows) kk(key)
            JOIN public.permissions p ON p.key = kk.key
           CROSS JOIN (SELECT x::uuid pid FROM jsonb_array_elements_text(plan->u->'own') x) o
          ON CONFLICT (user_id, permission_id, scope_type, scope_id) DO NOTHING
          RETURNING permission_id, scope_id)
        SELECT count(*), coalesce(jsonb_agg((SELECT key FROM public.permissions WHERE id = ins.permission_id) || ' @ ' || ins.scope_id), '[]') INTO n, g FROM ins;
        c := c || jsonb_build_object('ins_scoped', n, 'ins_scoped_rows', g);
        -- 3. scoped schools.* on programs that are not theirs (Makaio: SA Exp 2027)
        WITH d AS (
          DELETE FROM public.user_permissions up USING public.permissions p
           WHERE p.id = up.permission_id AND up.user_id = u::uuid AND up.scope_type = 'program'
             AND up.scope_id IN (SELECT x::uuid FROM jsonb_array_elements_text(plan->u->'drop_scoped') x)
             AND p.key LIKE 'schools.%'
          RETURNING p.key)
        SELECT count(*), coalesce(jsonb_agg(key ORDER BY key), '[]') INTO n, g FROM d;
        c := c || jsonb_build_object('del_dropped_program', n, 'del_dropped_program_keys', g);
        -- 4. org-wide template key
        INSERT INTO public.user_permissions (user_id, permission_id, scope_type, scope_id)
        SELECT u::uuid, p.id, NULL, NULL FROM public.permissions p
         WHERE p.key = c_tm
           AND NOT EXISTS (SELECT 1 FROM public.user_permissions x WHERE x.user_id = u::uuid AND x.permission_id = p.id AND x.scope_type IS NULL);
        GET DIAGNOSTICS n = ROW_COUNT;
        c := c || jsonb_build_object('ins_templates_manage', n);
        -- 5. program_leaders row (Enge, Leadership Track Q4/2026)
        n := 0;
        IF u::uuid = c_enge THEN
          INSERT INTO public.program_leaders (program_id, user_id, added_by)
          SELECT c_lt, c_enge, (SELECT pl.added_by FROM public.program_leaders pl WHERE pl.program_id = c_ffbx AND pl.user_id = c_mak)
          ON CONFLICT (program_id, user_id) DO NOTHING;
          GET DIAGNOSTICS n = ROW_COUNT;
        END IF;
        c := c || jsonb_build_object('ins_program_leaders', n);
        -- 6. unscoped finance keys to drop (Makaio: approve, edit, export; view stays)
        WITH d AS (
          DELETE FROM public.user_permissions up USING public.permissions p
           WHERE p.id = up.permission_id AND up.user_id = u::uuid AND up.scope_type IS NULL
             AND p.key IN (SELECT x FROM jsonb_array_elements_text(plan->u->'fin_drop_unscoped') x)
          RETURNING p.key)
        SELECT count(*), coalesce(jsonb_agg(key ORDER BY key), '[]') INTO n, g FROM d;
        c := c || jsonb_build_object('del_finance_unscoped', n, 'del_finance_unscoped_keys', g);
        -- 7. finance keys scoped to each own program, where missing
        WITH ins AS (
          INSERT INTO public.user_permissions (user_id, permission_id, scope_type, scope_id)
          SELECT u::uuid, p.id, 'program', o.pid
            FROM jsonb_array_elements_text(plan->u->'fin_scoped') kk(key)
            JOIN public.permissions p ON p.key = kk.key
           CROSS JOIN (SELECT x::uuid pid FROM jsonb_array_elements_text(plan->u->'own') x) o
          ON CONFLICT (user_id, permission_id, scope_type, scope_id) DO NOTHING
          RETURNING permission_id, scope_id)
        SELECT count(*), coalesce(jsonb_agg((SELECT key FROM public.permissions WHERE id = ins.permission_id) || ' @ ' || ins.scope_id), '[]') INTO n, g FROM ins;
        c := c || jsonb_build_object('ins_finance_scoped', n, 'ins_finance_scoped_rows', g);
        cnt := cnt || jsonb_build_object(nm, c);
      END LOOP;
    END IF;

    -- ── snapshot: grants (schools.* + finance.*) per key -> scopes ──
    m := '{}';
    FOR u IN SELECT jsonb_object_keys(plan) LOOP
      SELECT coalesce(jsonb_object_agg(key, sc), '{}') INTO g FROM (
        SELECT p.key, jsonb_agg(CASE WHEN up.scope_type IS NULL THEN '*org-wide*' ELSE coalesce(pg.name, up.scope_type || ':' || up.scope_id) END ORDER BY 1) sc
          FROM public.user_permissions up JOIN public.permissions p ON p.id = up.permission_id
          LEFT JOIN public.programs pg ON pg.id = up.scope_id AND up.scope_type = 'program'
         WHERE up.user_id = u::uuid AND (p.key LIKE 'schools.%' OR p.key LIKE 'finance.%')
         GROUP BY p.key) s;
      g := g || jsonb_build_object('program_leaders_rows',
             (SELECT coalesce(jsonb_agg(pg.name ORDER BY pg.name), '[]') FROM public.program_leaders pl JOIN public.programs pg ON pg.id = pl.program_id WHERE pl.user_id = u::uuid));
      m := m || jsonb_build_object(plan->u->>'name', g);
    END LOOP;
    IF k = 1 THEN before_g := m; ELSE after_g := m; END IF;

    -- ── snapshot: effective access, as the person: capability -> programs ──
    m := '{}';
    FOR u IN SELECT jsonb_object_keys(plan) LOOP
      PERFORM set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
      PERFORM set_config('request.jwt.claim.sub', u, true);
      EXECUTE 'SET LOCAL ROLE authenticated';
      acc := '{}';
      FOREACH cap IN ARRAY caps LOOP
        lst := '{}';
        FOR i IN 1..coalesce(array_length(pids, 1), 0) LOOP
          IF public.has_permission_for(cap, pids[i]) THEN lst := lst || pnames[i]; END IF;
        END LOOP;
        acc := acc || jsonb_build_object(replace(cap, 'schools.', ''), to_jsonb(lst));
      END LOOP;
      FOREACH cap IN ARRAY ARRAY['public.has_schools_access', 'public.can_manage_program_applications', 'public.lms_can_edit', 'public.lms_can_grade'] LOOP
        IF to_regprocedure(cap || '(uuid)') IS NOT NULL THEN
          lst := '{}';
          FOR i IN 1..coalesce(array_length(pids, 1), 0) LOOP
            EXECUTE format('SELECT %s($1)', cap) INTO b USING pids[i];
            IF b THEN lst := lst || pnames[i]; END IF;
          END LOOP;
          acc := acc || jsonb_build_object(replace(cap, 'public.', '') || '(p)', to_jsonb(lst));
        END IF;
      END LOOP;
      -- template library: read gate, and an actual (rolled-back) write
      acc := acc || jsonb_build_object('templates_read (has_schools_access())', public.has_schools_access());
      BEGIN
        INSERT INTO public.application_templates (name) VALUES ('f316 probe');
        RAISE EXCEPTION USING ERRCODE = 'P0F16';
      EXCEPTION WHEN SQLSTATE 'P0F16' THEN w := true;
                WHEN OTHERS THEN w := false;
      END;
      acc := acc || jsonb_build_object('templates_write (actual INSERT)', w,
                                       'finance org-wide view/edit/approve/export (has_permission)',
                                       public.has_permission('finance.view')::text || '/' || public.has_permission('finance.edit')::text || '/' ||
                                       public.has_permission('finance.approve')::text || '/' || public.has_permission('finance.export')::text);
      EXECUTE 'RESET ROLE';
      m := m || jsonb_build_object(plan->u->>'name', acc);
    END LOOP;
    PERFORM set_config('request.jwt.claims', '', true);
    PERFORM set_config('request.jwt.claim.sub', '', true);
    IF k = 1 THEN before_a := m; ELSE after_a := m; END IF;
  END LOOP;

  res := jsonb_build_object(
    'mode', CASE WHEN v_commit THEN 'commit' ELSE 'verify' END,
    'preconditions', jsonb_build_object('313', has_313, '316', has_316, '310', has_310, '312', has_312, 'key_seeded_for_preview', seeded_key),
    'counts', cnt, 'expected', c_expected,
    'grants_before', before_g, 'grants_after', after_g,
    'access_before', before_a, 'access_after', after_a);

  IF NOT v_commit THEN
    RAISE EXCEPTION 'VERIFY_RESULTS %', res;
  END IF;
  -- commit mode: exact counts per person, or nothing changes.
  FOR nm IN SELECT jsonb_object_keys(c_expected) LOOP
    FOR cap IN SELECT jsonb_object_keys(c_expected->nm) LOOP
      IF (cnt->nm->>cap)::int IS DISTINCT FROM (c_expected->nm->>cap)::int THEN
        RAISE EXCEPTION 'F aborted: % % = %, expected %. Nothing changed. %', nm, cap, cnt->nm->>cap, c_expected->nm->>cap, res;
      END IF;
    END LOOP;
  END LOOP;
  RAISE NOTICE 'F_COMMITTED %', res;
END
$f$;
