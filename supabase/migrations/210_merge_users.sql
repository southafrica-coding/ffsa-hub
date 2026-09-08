-- ============================================================
-- FFSA Hub — Migration 210: Merge two duplicate people into one account
-- ============================================================
-- A student can end up with two Hub accounts. They apply publicly with one
-- email while a profile already exists under another, and accept-application
-- matches on a case-sensitive `.eq` against users.email, so the match misses
-- and a second auth user + users row is created. Both halves then collect
-- real data and both get enrolled, so the student appears twice on the
-- Arrival roster and neither account is complete.
--
-- Observed on the FFBX September 2026 intake (2026-09-08): two students, each
-- with one account holding the application + billing plan and another holding
-- the household, insurance and consent records they filled in at onboarding.
--
-- Deleting one side was the old workaround. It must not be: deleting a user
-- is what unlinked applications and enrolments in the first place (see
-- migrations 200 and 207). This merge moves the records instead and leaves
-- the losing row in place, deactivated and tombstoned.
--
-- ── Why a SQL function rather than TypeScript ────────────────
-- PostgREST gives the app no transaction. A merge that repoints an
-- enrolment, a billing plan, consent records and roles over ~10 round-trips
-- can fail halfway and leave a student with billing on one account and an
-- enrolment on another — the exact bug this exists to fix, but worse. A
-- function body is one transaction, so the merge is all-or-nothing.
--
-- ── Three conflict rules, not one ────────────────────────────
-- Blind repointing violates unique constraints, because both accounts are
-- typically enrolled in the SAME program:
--
--   enrollments            UNIQUE (user_id, program_id)
--   application_responses  UNIQUE (user_id, program_id) WHERE user_id NOT NULL
--   student_billing_plans  UNIQUE (enrollment_id, course_id)
--
-- The billing constraint is the trap. A plan is anchored to an ENROLMENT,
-- not to a user. In both real cases the plan hangs off the LOSER's enrolment
-- — the one being taken off the roster. Repointing user_id alone would leave
-- an active billing plan attached to a removed enrolment, i.e. money silently
-- detached from the roster. So the plan is re-anchored to the surviving
-- enrolment before the loser's is retired.
--
-- reference_requests and one consent_record key off application_id rather
-- than user_id, so they follow the application automatically — provided the
-- application is REPOINTED and not orphaned. That is why the application
-- rule prefers repointing and only demotes on a genuine collision.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Tombstone columns on users.
--
--    The loser is never deleted, so without these it becomes an anonymous
--    inactive account. merged_into_user_id makes the pair traceable and lets
--    the UI say "merged into <name>" instead of showing a mystery.
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS merged_into_user_id uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS merged_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_users_merged_into
  ON public.users (merged_into_user_id)
  WHERE merged_into_user_id IS NOT NULL;

COMMENT ON COLUMN public.users.merged_into_user_id IS
  'Set by merge_users(). This account was merged into that one and is retired.';

-- ────────────────────────────────────────────────────────────
-- 2. The allow-list of what a merge moves.
--
--    ~144 columns across the schema reference users.id. A fully dynamic
--    merge that repoints all of them is unreviewable and would silently
--    start touching tables added years from now, including ones where
--    repointing is WRONG (audit trails, created_by on records the winner
--    never created).
--
--    So: an explicit list, each row carrying its own policy. The weakness of
--    an allow-list — a new table gets missed — is covered by the guard scan
--    in merge_users, and fails safe: missed rows stay on the loser, who
--    still exists, so nothing is destroyed and the merge can be re-run.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_merge_targets (
  table_name  text NOT NULL,
  column_name text NOT NULL,
  policy      text NOT NULL CHECK (policy IN (
                'repoint',       -- straight UPDATE to the winner
                'handled',       -- dealt with explicitly by merge_users
                'keep_history',  -- deliberately left on the loser
                'skip'
              )),
  notes       text,
  PRIMARY KEY (table_name, column_name)
);

COMMENT ON TABLE public.user_merge_targets IS
  'Drives merge_users(). Add a row when a new table gains a users.id FK, or '
  'the guard scan in merge_users will refuse to merge.';

INSERT INTO public.user_merge_targets (table_name, column_name, policy, notes) VALUES
  ('enrollments',            'user_id',      'handled',      'unique (user_id, program_id); see step 4'),
  ('application_responses',  'user_id',      'handled',      'unique (user_id, program_id); see step 5'),
  ('user_roles',             'user_id',      'handled',      'set membership; de-duplicated in step 6'),
  ('student_billing_plans',  'user_id',      'repoint',      'enrollment_id re-anchored in step 4'),
  ('consent_records',        'user_id',      'repoint',      'consent given by the human, follows them'),
  ('households',             'created_by',   'repoint',      NULL),
  ('household_members',      'user_id',      'repoint',      NULL),
  ('user_insurance_policies','user_id',      'repoint',      NULL),
  ('onboarding_invites',     'user_id',      'repoint',      NULL),
  ('user_roles',             'assigned_by',  'repoint',      'same human either way'),
  ('enrollments',            'enrolled_by',  'repoint',      NULL),
  ('enrollments',            'removed_by',   'repoint',      NULL),
  ('enrollments',            'insurance_verified_by', 'repoint', NULL),
  ('audit_logs',             'user_id',      'keep_history', 'who actually acted stays true; the loser row survives')
ON CONFLICT (table_name, column_name) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 3. merge_users
--
--    p_dry_run = true (the DEFAULT) performs the entire real merge and then
--    raises, rolling everything back. That is deliberately stronger than a
--    counting-only preview: it surfaces real constraint violations against
--    real data with zero mutation. Callers catch SQLSTATE 'FFSA1' and read
--    the report out of the exception DETAIL.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.merge_users(
  p_winner  uuid,
  p_loser   uuid,
  p_actor   uuid,
  p_dry_run boolean DEFAULT true,
  p_strict  boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_report      jsonb := '{}'::jsonb;
  v_moved       jsonb := '{}'::jsonb;
  v_collisions  jsonb := '[]'::jsonb;
  v_leftovers   jsonb := '[]'::jsonb;
  v_loser_email text;
  v_loser_info  jsonb;
  v_n           bigint;
  r             record;
BEGIN
  -- ---- guards -------------------------------------------------
  IF p_winner IS NULL OR p_loser IS NULL OR p_actor IS NULL THEN
    RAISE EXCEPTION 'winner, loser and actor are all required';
  END IF;
  IF p_winner = p_loser THEN
    RAISE EXCEPTION 'Cannot merge an account into itself';
  END IF;
  IF p_loser = p_actor THEN
    RAISE EXCEPTION 'You cannot merge away your own account';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_winner) THEN
    RAISE EXCEPTION 'Winner account % does not exist', p_winner;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_loser) THEN
    RAISE EXCEPTION 'Losing account % does not exist', p_loser;
  END IF;
  IF EXISTS (SELECT 1 FROM public.users WHERE id = p_loser
               AND merged_into_user_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Account % has already been merged', p_loser;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.user_roles ur
    JOIN public.roles ro ON ro.id = ur.role_id
    WHERE ur.user_id = p_loser AND ro.name = 'super_admin'
  ) THEN
    RAISE EXCEPTION 'Refusing to merge away a super_admin account';
  END IF;

  SELECT u.email,
         jsonb_build_object('first_name', u.first_name,
                            'last_name',  u.last_name,
                            'email',      u.email)
    INTO v_loser_email, v_loser_info
    FROM public.users u WHERE u.id = p_loser;

  -- ---- 4. enrolments, and the billing plans anchored to them ---
  --
  -- Where both accounts sit in the same program, the WINNER's enrolment is
  -- the one that stays live. Any billing plan on the loser's enrolment is
  -- re-anchored onto the winner's first — otherwise it would be left
  -- pointing at an enrolment that is about to come off the roster.
  --
  -- The (enrollment_id, course_id) unique constraint means a plan can only
  -- move if the winner has no plan for that same course; if they do, the
  -- winner's stands and the loser's is reported as a collision rather than
  -- silently dropped.
  FOR r IN
    SELECT l.id AS loser_enr, w.id AS winner_enr, l.program_id
      FROM public.enrollments l
      JOIN public.enrollments w
        ON w.user_id = p_winner AND w.program_id = l.program_id
     WHERE l.user_id = p_loser
  LOOP
    UPDATE public.student_billing_plans bp
       SET enrollment_id = r.winner_enr,
           user_id       = p_winner
     WHERE bp.enrollment_id = r.loser_enr
       AND NOT EXISTS (
             SELECT 1 FROM public.student_billing_plans x
              WHERE x.enrollment_id = r.winner_enr
                AND x.course_id IS NOT DISTINCT FROM bp.course_id);

    SELECT count(*) INTO v_n
      FROM public.student_billing_plans
     WHERE enrollment_id = r.loser_enr;

    -- Retire the loser's enrolment: soft-remove it so it lands under
    -- "Removed" on the Students tab, then detach it from the person so the
    -- unique constraint is free. Nulling user_id is legal since 207; the
    -- person_* columns keep it identifiable.
    UPDATE public.enrollments
       SET removed_at   = COALESCE(removed_at, now()),
           removed_by   = COALESCE(removed_by, p_actor),
           user_id      = NULL,
           person_email = COALESCE(person_email, v_loser_email),
           person_info  = COALESCE(person_info,  v_loser_info)
     WHERE id = r.loser_enr;

    v_collisions := v_collisions || jsonb_build_object(
      'table',            'enrollments',
      'program_id',       r.program_id,
      'kept',             r.winner_enr,
      'retired',          r.loser_enr,
      'plans_left_behind', v_n);
  END LOOP;

  -- Anything not colliding just moves.
  UPDATE public.enrollments SET user_id = p_winner WHERE user_id = p_loser;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_moved := v_moved || jsonb_build_object('enrollments.user_id', v_n);

  -- ---- 5. applications ----------------------------------------
  --
  -- Repoint by preference: reference_requests and consent_records hang off
  -- application_id, so a repointed application carries them along. Only a
  -- real collision demotes the loser's copy, and demotion preserves the
  -- applicant identity in the denormalised columns migration 200 added.
  FOR r IN
    SELECT l.id AS loser_app, l.program_id
      FROM public.application_responses l
      JOIN public.application_responses w
        ON w.user_id = p_winner AND w.program_id = l.program_id
     WHERE l.user_id = p_loser
  LOOP
    UPDATE public.application_responses
       SET user_id         = NULL,
           applicant_email  = COALESCE(applicant_email, v_loser_email),
           applicant_info   = COALESCE(applicant_info,  v_loser_info)
     WHERE id = r.loser_app;

    v_collisions := v_collisions || jsonb_build_object(
      'table',      'application_responses',
      'program_id', r.program_id,
      'demoted',    r.loser_app);
  END LOOP;

  UPDATE public.application_responses SET user_id = p_winner WHERE user_id = p_loser;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_moved := v_moved || jsonb_build_object('application_responses.user_id', v_n);

  -- ---- 6. roles ------------------------------------------------
  --
  -- Roles are set membership, so duplicates are noise. IS NOT DISTINCT FROM
  -- is what makes NULL scope columns compare equal — the comparison the
  -- unique constraint refuses to make (see migration 209).
  DELETE FROM public.user_roles l
   WHERE l.user_id = p_loser
     AND EXISTS (
       SELECT 1 FROM public.user_roles w
        WHERE w.user_id    = p_winner
          AND w.role_id    = l.role_id
          AND w.scope_type IS NOT DISTINCT FROM l.scope_type
          AND w.scope_id   IS NOT DISTINCT FROM l.scope_id);

  UPDATE public.user_roles SET user_id = p_winner WHERE user_id = p_loser;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_moved := v_moved || jsonb_build_object('user_roles.user_id', v_n);

  -- ---- 7. everything else on the allow-list --------------------
  FOR r IN
    SELECT table_name, column_name FROM public.user_merge_targets
     WHERE policy = 'repoint' ORDER BY table_name, column_name
  LOOP
    EXECUTE format('UPDATE public.%I SET %I = $1 WHERE %I = $2',
                   r.table_name, r.column_name, r.column_name)
      USING p_winner, p_loser;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n > 0 THEN
      v_moved := v_moved || jsonb_build_object(
        r.table_name || '.' || r.column_name, v_n);
    END IF;
  END LOOP;

  -- ---- 8. guard scan -------------------------------------------
  --
  -- Any OTHER column with a users.id FK still holding loser rows means the
  -- allow-list is out of date. In strict mode that aborts the whole merge
  -- rather than quietly leaving records behind.
  FOR r IN
    SELECT c.conrelid::regclass::text AS tbl, a.attname::text AS col
      FROM pg_constraint c
      JOIN unnest(c.conkey) WITH ORDINALITY k(attnum, ord) ON true
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
     WHERE c.contype = 'f'
       AND c.confrelid = 'public.users'::regclass
       AND c.connamespace = 'public'::regnamespace
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.user_merge_targets t
       WHERE t.table_name = split_part(r.tbl, '.', -1)
         AND t.column_name = r.col
    ) THEN CONTINUE; END IF;

    EXECUTE format('SELECT count(*) FROM %s WHERE %I = $1', r.tbl, r.col)
      INTO v_n USING p_loser;

    IF v_n > 0 THEN
      v_leftovers := v_leftovers || jsonb_build_object(
        'ref', r.tbl || '.' || r.col, 'rows', v_n);
    END IF;
  END LOOP;

  IF jsonb_array_length(v_leftovers) > 0 AND p_strict THEN
    RAISE EXCEPTION 'Unhandled references to the losing account: %',
      v_leftovers::text
      USING HINT = 'Add these columns to public.user_merge_targets, then retry.';
  END IF;

  -- ---- 9. retire the loser -------------------------------------
  UPDATE public.users
     SET is_active           = false,
         merged_into_user_id = p_winner,
         merged_at           = now()
   WHERE id = p_loser;

  v_report := jsonb_build_object(
    'winner',     p_winner,
    'loser',      p_loser,
    'loser_email', v_loser_email,
    'moved',      v_moved,
    'collisions', v_collisions,
    'leftovers',  v_leftovers,
    'dry_run',    p_dry_run);

  -- Written inside the transaction, so it can never disagree with what
  -- actually happened — including not existing at all after a dry run.
  INSERT INTO public.audit_logs (user_id, action, resource_type, resource_id, metadata)
  VALUES (p_actor, 'merge_users', 'users', p_winner, v_report);

  IF p_dry_run THEN
    RAISE EXCEPTION 'DRY RUN — no changes were kept'
      USING ERRCODE = 'FFSA1', DETAIL = v_report::text;
  END IF;

  RETURN v_report;
END;
$$;

-- Service-role only. A SECURITY DEFINER function callable by `authenticated`
-- would be a privilege-escalation hole.
REVOKE ALL ON FUNCTION public.merge_users(uuid, uuid, uuid, boolean, boolean)
  FROM public, anon, authenticated;

-- ────────────────────────────────────────────────────────────
-- 10. preview_merge_users — read-only counts for a fast UI render.
--
--     This is the cheap "what would move" view. It cannot catch constraint
--     violations; the dry run above is what proves a merge will succeed.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.preview_merge_users(p_winner uuid, p_loser uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rows jsonb := '{}'::jsonb;
  v_n    bigint;
  r      record;
BEGIN
  FOR r IN
    SELECT table_name, column_name FROM public.user_merge_targets
     WHERE policy IN ('repoint', 'handled') ORDER BY table_name, column_name
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE %I = $1',
                   r.table_name, r.column_name)
      INTO v_n USING p_loser;
    IF v_n > 0 THEN
      v_rows := v_rows || jsonb_build_object(
        r.table_name || '.' || r.column_name, v_n);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'loser_rows', v_rows,
    'shared_programs', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'program_id', p.id, 'program', p.name,
               'winner_status', w.status, 'loser_status', l.status))
        FROM public.enrollments l
        JOIN public.enrollments w
          ON w.user_id = p_winner AND w.program_id = l.program_id
        JOIN public.programs p ON p.id = l.program_id
       WHERE l.user_id = p_loser), '[]'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.preview_merge_users(uuid, uuid)
  FROM public, anon, authenticated;
