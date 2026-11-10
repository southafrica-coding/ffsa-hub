-- ============================================================
-- F: program leaders back to their own programs (Jack, 10 Nov 2026:
-- "own programs for now"). Data script, NOT a migration.
-- ============================================================
-- People and "own program" evidence (prod, read-only, 10 Nov 2026):
--   41763eb6 Makaio McDowell -> FFBX September 2026 (5256f736)
--       program_leader role scoped to it, program_leaders row, and he
--       created the program.
--   542986ea Enge Swart      -> Leadership Track Q4/2026 (2783427b)
--       program_leader role scoped to it (assigned 17 Jul 2026). She has
--       NO program_leaders row and created no program, so the role scope
--       is the only evidence. (Jack's question G is still open.)
-- Both ALSO hold admin-granted scoped copies of the same keys for
-- Fire & Fragrance SA Experience 2027 (f839fd44, granted by 68f5d637).
--
-- What it does:
--   1. Deletes their UNSCOPED schools.manage, schools.approve_applications
--      and schools.manage_enrollments grants (6 rows on prod).
--   2. Ensures the same 3 keys exist scoped to their own program
--      (already there on prod, so 0 inserts expected; idempotent).
--   3. Only if SWITCH 1 is true: also deletes their scoped grants of the
--      same 3 keys for SA Experience 2027 (6 rows). Jack must confirm.
--   Not touched: their unscoped schools.view, view_applications and
--   manage_attendance (they still SEE every program and can mark
--   attendance everywhere), their roles, and other keys.
--
-- ORDER: on live today (305, no 310/312/313) this changes nothing in
-- practice: has_schools_access() / has_permission count any scope, and
-- 305's lms_can_edit + the unscoped program_leader role branch of
-- can_manage_program_applications still cover every program. Run it
-- only after 313 (and 310 or 312) are applied.
--
-- Run:  psql -v ON_ERROR_STOP=1 -f f_program_leaders.sql
-- verify mode (default) always ends in RAISE EXCEPTION 'VERIFY_RESULTS
-- {...}' so everything rolls back and the JSON shows before/after.
-- commit mode checks the expected row counts and aborts if they differ.
-- ============================================================

SELECT set_config('f316.remove_sa_exp_2027', 'false', false);  -- SWITCH 1: false = KEEP SA Experience 2027 grants (default) | true = remove them
SELECT set_config('f316.mode', 'verify', false);                -- SWITCH 2: verify (roll back, default) | commit

DO $f$
DECLARE
  v_remove_sa boolean := coalesce(nullif(current_setting('f316.remove_sa_exp_2027', true), ''), 'false')::boolean;
  v_commit    boolean := coalesce(current_setting('f316.mode', true), 'verify') = 'commit';
  c_sa  constant uuid := 'f839fd44-0051-4d47-ab8d-b548c5d32648';
  c_keys constant text[] := ARRAY['schools.manage', 'schools.approve_applications', 'schools.manage_enrollments'];
  own  jsonb := jsonb_build_object(
          '41763eb6-23e3-4837-93c3-7e568be8dc29', '5256f736-2eaa-49df-909e-0dd3de48fe4f',
          '542986ea-5b7f-481a-86c9-2061d0d2fc8a', '2783427b-de98-4620-b7f4-7defd51010ef');
  has_e boolean := to_regprocedure('public.lms_can_edit(uuid)') IS NOT NULL;
  has_a boolean := to_regprocedure('public.can_manage_program_applications(uuid)') IS NOT NULL;
  u text; i int; pids uuid[]; pnames text[]; cell text; b boolean;
  before_g jsonb; after_g jsonb; before_m jsonb := '{}'; after_m jsonb := '{}'; m jsonb;
  n_del_unscoped int; n_ins int := 0; n_del_sa int := 0; k int; res jsonb;
BEGIN
  FOR k IN 1..2 LOOP
    IF k = 2 THEN
      -- ── the change ──
      DELETE FROM public.user_permissions up
       USING public.permissions p
       WHERE p.id = up.permission_id
         AND up.user_id IN (SELECT x::uuid FROM jsonb_object_keys(own) x)
         AND up.scope_type IS NULL
         AND p.key = ANY (c_keys);
      GET DIAGNOSTICS n_del_unscoped = ROW_COUNT;

      INSERT INTO public.user_permissions (user_id, permission_id, scope_type, scope_id)
      SELECT o.key::uuid, p.id, 'program', (o.value #>> '{}')::uuid
        FROM jsonb_each(own) o CROSS JOIN public.permissions p
       WHERE p.key = ANY (c_keys)
      ON CONFLICT (user_id, permission_id, scope_type, scope_id) DO NOTHING;
      GET DIAGNOSTICS n_ins = ROW_COUNT;

      IF v_remove_sa THEN
        DELETE FROM public.user_permissions up
         USING public.permissions p
         WHERE p.id = up.permission_id
           AND up.user_id IN (SELECT x::uuid FROM jsonb_object_keys(own) x)
           AND up.scope_type = 'program' AND up.scope_id = c_sa
           AND p.key = ANY (c_keys);
        GET DIAGNOSTICS n_del_sa = ROW_COUNT;
      END IF;
    END IF;

    -- ── snapshot: grant counts ──
    SELECT jsonb_object_agg(uid8, j) INTO m FROM (
      SELECT left(g.user_id::text, 8) uid8,
             jsonb_build_object(
               'unscoped', (SELECT count(*) FROM public.user_permissions up JOIN public.permissions p ON p.id = up.permission_id
                             WHERE up.user_id = g.user_id AND up.scope_type IS NULL AND p.key = ANY (c_keys)),
               'scoped_by_program', (SELECT jsonb_object_agg(coalesce(pg.name, up.scope_id::text), n) FROM (
                    SELECT up.scope_id, count(*) n FROM public.user_permissions up JOIN public.permissions p ON p.id = up.permission_id
                     WHERE up.user_id = g.user_id AND up.scope_type = 'program' AND p.key = ANY (c_keys) GROUP BY 1) up
                    LEFT JOIN public.programs pg ON pg.id = up.scope_id)) j
      FROM (SELECT x::uuid user_id FROM jsonb_object_keys(own) x) g) s;
    IF k = 1 THEN before_g := m; ELSE after_g := m; END IF;

    -- ── snapshot: effective access per program, as the person ──
    -- M/P/N = has_permission_for(manage / approve_applications / manage_enrollments, program)
    -- E = lms_can_edit, A = can_manage_program_applications (if present), '-' = no
    -- T = has_schools_access() (live template + grades gate), W = 316 template write gate
    m := '{}';
    SELECT array_agg(id ORDER BY name), array_agg(name ORDER BY name) INTO pids, pnames FROM public.programs;  -- read as owner, before switching role
    FOREACH u IN ARRAY ARRAY(SELECT jsonb_object_keys(own)) LOOP
      PERFORM set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
      PERFORM set_config('request.jwt.claim.sub', u, true);
      EXECUTE 'SET LOCAL ROLE authenticated';
      cell := '';
      FOR i IN 1..coalesce(array_length(pids, 1), 0) LOOP
        cell := cell || pnames[i] || '='
          || CASE WHEN public.has_permission_for('schools.manage', pids[i]) THEN 'M' ELSE '-' END
          || CASE WHEN public.has_permission_for('schools.approve_applications', pids[i]) THEN 'P' ELSE '-' END
          || CASE WHEN public.has_permission_for('schools.manage_enrollments', pids[i]) THEN 'N' ELSE '-' END;
        IF has_e THEN EXECUTE 'SELECT public.lms_can_edit($1)' INTO b USING pids[i]; cell := cell || CASE WHEN b THEN 'E' ELSE '-' END; END IF;
        IF has_a THEN EXECUTE 'SELECT public.can_manage_program_applications($1)' INTO b USING pids[i]; cell := cell || CASE WHEN b THEN 'A' ELSE '-' END; END IF;
        cell := cell || '; ';
      END LOOP;
      cell := cell || 'T=' || CASE WHEN public.has_schools_access() THEN 'y' ELSE 'n' END
                   || ' W=' || CASE WHEN public.is_admin() OR public.has_permission_for('schools.manage', NULL::uuid) THEN 'y' ELSE 'n' END;
      EXECUTE 'RESET ROLE';
      m := m || jsonb_build_object(left(u, 8), cell);
    END LOOP;
    PERFORM set_config('request.jwt.claims', '', true);
    PERFORM set_config('request.jwt.claim.sub', '', true);
    IF k = 1 THEN before_m := m; ELSE after_m := m; END IF;
  END LOOP;

  res := jsonb_build_object(
    'mode', CASE WHEN v_commit THEN 'commit' ELSE 'verify' END,
    'remove_sa_exp_2027', v_remove_sa,
    'deleted_unscoped', n_del_unscoped, 'inserted_own_scoped', n_ins, 'deleted_sa_exp_2027', n_del_sa,
    'grants_before', before_g, 'grants_after', after_g,
    'access_before', before_m, 'access_after', after_m,
    'legend', 'per program: M/P/N=has_permission_for manage/approve/enrollments, E=lms_can_edit, A=can_manage_program_applications; T=has_schools_access(), W=template write (316)');

  IF NOT v_commit THEN
    RAISE EXCEPTION 'VERIFY_RESULTS %', res;
  END IF;
  -- commit mode: refuse anything unexpected.
  IF n_del_unscoped <> 6 OR (v_remove_sa AND n_del_sa <> 6) THEN
    RAISE EXCEPTION 'F aborted: expected 6 unscoped (and 6 SA Exp 2027 if switched on) rows, got % / %. Nothing changed. %', n_del_unscoped, n_del_sa, res;
  END IF;
  RAISE NOTICE 'F_COMMITTED %', res;
END
$f$;
