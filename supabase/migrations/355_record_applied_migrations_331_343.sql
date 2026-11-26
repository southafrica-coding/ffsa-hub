-- ============================================================
-- FFSA Hub — Migration 355: record already-applied migrations 331–343
-- ============================================================
-- DRAFT. Do not run this against production until Jack OKs it.
-- Previews share the production database.
--
-- WHAT THIS DOES. Inserts history rows into
-- supabase_migrations.schema_migrations for thirteen migration files
-- whose objects are already on production but which were applied by
-- hand in the SQL editor and never recorded:
--
--   331_missio_house_churches          337_missio_coaches
--   332_missio_connect_funnel          338_missio_roles
--   333_missio_volunteer_availability  339_missio_house_feedback
--   334_training_foundations           340_missio_placements
--   335_activity_events_select_staff   341_missio_households
--   336_save_student_checkin           342_missio_next_leaders
--                                      343_missio_care
--
-- It creates no tables, functions, views, policies or triggers, and
-- writes no app data. It does not run any statement from 331–343.
--
-- PLACEHOLDER VERSIONS. The original apply times for these files
-- cannot be reconstructed from the repo or from prod, so the
-- versions below are NOT the original apply times. They are a
-- documented synthetic band, 20261122194101 to 20261122194113, one
-- second apart in file order, placed after the latest recorded row
-- (344_users_color_scheme = 20261122193041) so they cannot collide
-- with any existing row. The name column carries the real file name.
--
-- CHECKS FIRST. Before inserting anything, the block confirms every
-- table, view, function and policy that 331–343 create is present,
-- and that the policy 335 removes is gone. If any check fails it
-- raises an exception and inserts nothing (the block is one
-- statement, so it is all or nothing).
--
-- IDEMPOTENT. A file is skipped when its name is already recorded
-- under any version. If a placeholder version is already taken by a
-- different name, the block refuses rather than guess.
--
-- Disposable test: supabase/tests/record_applied_migrations_331_343_test.sql
-- ============================================================

DO $$
DECLARE
  -- Tables created by 331–343 (all in public).
  want_tables text[] := ARRAY[
    -- 331
    'house_churches', 'house_church_members', 'missio_import_review',
    -- 332
    'connect_responses', 'missio_followups', 'missio_followup_stage_history',
    -- 333
    'availability_requests', 'availability_tokens', 'availability_responses',
    'missio_teams', 'missio_team_leaders', 'missio_team_members',
    -- 334
    'enrollment_staff', 'student_checkins', 'student_checkin_private',
    'today_dismissals',
    -- 337
    'missio_coach_assignments',
    -- 339
    'missio_feedback_links', 'missio_house_feedback',
    -- 340
    'missio_placements',
    -- 341
    'missio_households', 'missio_household_members',
    -- 342
    'missio_next_leaders',
    -- 343
    'missio_care_requests'
  ];

  -- Views created by 331 and 332.
  want_views text[] := ARRAY[
    'missio_member_status', 'missio_followup_effective', 'missio_not_in_house'
  ];

  -- Functions created by 331–343, plus the two 329 helpers they all
  -- depend on. Checked by name in public.
  want_functions text[] := ARRAY[
    -- 329 (already recorded; dependency of everything below)
    'has_org_role', 'has_org_role_id',
    -- 331
    'is_missio_member', 'guard_house_church_member',
    'guard_missio_import_review_resolve',
    -- 332
    'missio_phone_e164', 'missio_phone_e164_try', 'missio_fold_phone_digits',
    'assign_missio_connect_match', 'attach_missio_connect_response',
    'decline_missio_connect_match', 'guard_missio_connect_contact',
    'link_missio_connect_match', 'mark_missio_followup_joined',
    'missio_followup_lock', 'pin_missio_followup_changed_by',
    'record_missio_followup_stage', 'set_connect_response_phone_e164',
    -- 333
    'missio_availability_contact_on_roster', 'availability_dates_in_range',
    'availability_request_stamp_creator', 'availability_response_guard',
    'missio_volunteer_contact_in_org', 'missio_volunteer_org_is_missio',
    -- 334
    'is_walking_with', 'walking_with_enrollment_ids', 'is_own_enrollment',
    'is_school_staff_for_enrollment', 'can_manage_checkin',
    'can_read_checkin_private', 'is_checkin_author', 'my_checkin_notes',
    'student_checkins_guard', 'enrollment_staff_mirror_assigned',
    'training_enrollment_program', 'training_touch_updated_at',
    -- 336
    'save_student_checkin',
    -- 338
    'missio_my_contact_id', 'missio_my_house_ids', 'missio_led_house_ids',
    'missio_coached_house_ids',
    -- 341
    'missio_my_household_ids'
  ];

  -- Policies created by 331–343, as 'table|policy name'.
  want_policies text[] := ARRAY[
    -- 331
    'house_churches|Pastors can read house churches',
    'house_churches|Pastors can insert house churches',
    'house_churches|Pastors can update house churches',
    'house_church_members|Pastors can read house church members',
    'house_church_members|Pastors can insert house church members',
    'house_church_members|Pastors can update house church members',
    'missio_import_review|Pastors can read import review',
    'missio_import_review|Pastors can resolve import review',
    -- 332
    'connect_responses|Pastors can read connect responses',
    'connect_responses|Pastors can insert manual connect responses',
    'connect_responses|Pastors can update connect responses',
    'missio_followups|Pastors can read followups',
    'missio_followups|Pastors can insert followups',
    'missio_followups|Pastors can update followups',
    'missio_followup_stage_history|Pastors can read followup history',
    'missio_followup_stage_history|Pastors can insert followup notes',
    -- 333
    'missio_teams|Missio pastors manage teams',
    'missio_team_leaders|Missio pastors manage team leaders',
    'missio_team_members|Missio pastors manage team members',
    'availability_requests|Missio pastors read availability requests',
    'availability_requests|Missio pastors insert availability requests',
    'availability_requests|Missio pastors delete availability requests',
    'availability_responses|Missio pastors read availability responses',
    -- 334
    'enrollment_staff|Read enrollment staff',
    'enrollment_staff|Managers add enrollment staff',
    'enrollment_staff|Managers change enrollment staff',
    'enrollment_staff|Managers remove enrollment staff',
    'enrollments|Walkers can read their enrollments',
    'student_checkins|School staff read check-ins',
    'student_checkins|School staff write check-ins',
    'student_checkins|Author, walkers and leaders update check-ins',
    'student_checkins|Author or leaders delete check-ins',
    'student_checkin_private|Read staff-only check-in notes',
    'student_checkin_private|Author writes staff-only note',
    'student_checkin_private|Author edits staff-only note',
    'student_checkin_private|Author or leaders remove staff-only note',
    'today_dismissals|Own today dismissals read',
    'today_dismissals|Own today dismissals add',
    'today_dismissals|Own today dismissals remove',
    -- 335
    'activity_events|Staff can read activity events',
    -- 337
    'missio_coach_assignments|Pastors can read coach assignments',
    'missio_coach_assignments|Pastors can add coach assignments',
    'missio_coach_assignments|Pastors can end coach assignments',
    -- 338
    'house_churches|Coaches and leaders can read their houses',
    'house_church_members|Coaches and leaders can read their house members',
    'missio_coach_assignments|Coaches and leaders can read their house coach',
    'house_church_members|Coaches can update members of their houses',
    -- 339
    'missio_house_feedback|Pastors can read house feedback',
    'missio_house_feedback|Coaches and leaders can read their house feedback',
    -- 340
    'missio_placements|Pastors can read placements',
    'missio_placements|Coaches and leaders can read placements into their houses',
    -- 341
    'missio_households|Pastors manage households',
    'missio_household_members|Pastors manage household members',
    'missio_households|House leaders and coaches read their households',
    'missio_household_members|House leaders and coaches read their household members',
    -- 342
    'missio_next_leaders|Pastors manage next leaders',
    'missio_next_leaders|Coaches and leaders read next leaders in their houses',
    'missio_next_leaders|Coaches and leaders nominate in their houses',
    'missio_next_leaders|Coaches and leaders move next leaders in their houses',
    -- 343
    'missio_care_requests|Pastors read care requests',
    'missio_care_requests|Pastors update care requests',
    'missio_care_requests|Pastors log care requests'
  ];

  -- Policies 331–343 remove, as 'table|policy name'. Must be absent.
  gone_policies text[] := ARRAY[
    -- 335
    'activity_events|Auth users can read activity events'
  ];

  -- Placeholder versions (not original apply times; see header).
  rec_versions text[] := ARRAY[
    '20261122194101', '20261122194102', '20261122194103',
    '20261122194104', '20261122194105', '20261122194106',
    '20261122194107', '20261122194108', '20261122194109',
    '20261122194110', '20261122194111', '20261122194112',
    '20261122194113'
  ];
  rec_names text[] := ARRAY[
    '331_missio_house_churches',
    '332_missio_connect_funnel',
    '333_missio_volunteer_availability',
    '334_training_foundations',
    '335_activity_events_select_staff',
    '336_save_student_checkin',
    '337_missio_coaches',
    '338_missio_roles',
    '339_missio_house_feedback',
    '340_missio_placements',
    '341_missio_households',
    '342_missio_next_leaders',
    '343_missio_care'
  ];

  missing text[] := ARRAY[]::text[];
  item text;
  taken_name text;
  i int;
  n_inserted int := 0;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
    RAISE EXCEPTION '355: supabase_migrations.schema_migrations does not exist';
  END IF;

  -- Stop a concurrent recorder from racing the NOT EXISTS checks.
  LOCK TABLE supabase_migrations.schema_migrations IN SHARE ROW EXCLUSIVE MODE;

  -- ---- Preflight: every expected object is present ----

  FOREACH item IN ARRAY want_tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = item AND c.relkind IN ('r', 'p')
    ) THEN
      missing := missing || ('table public.' || item);
    END IF;
  END LOOP;

  FOREACH item IN ARRAY want_views LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = item AND c.relkind IN ('v', 'm')
    ) THEN
      missing := missing || ('view public.' || item);
    END IF;
  END LOOP;

  FOREACH item IN ARRAY want_functions LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = item
    ) THEN
      missing := missing || ('function public.' || item);
    END IF;
  END LOOP;

  FOREACH item IN ARRAY want_policies LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = split_part(item, '|', 1)
        AND policyname = split_part(item, '|', 2)
    ) THEN
      missing := missing || ('policy "' || split_part(item, '|', 2)
                             || '" on public.' || split_part(item, '|', 1));
    END IF;
  END LOOP;

  FOREACH item IN ARRAY gone_policies LOOP
    IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = split_part(item, '|', 1)
        AND policyname = split_part(item, '|', 2)
    ) THEN
      missing := missing || ('policy "' || split_part(item, '|', 2)
                             || '" on public.' || split_part(item, '|', 1)
                             || ' should have been dropped by 335');
    END IF;
  END LOOP;

  IF array_length(missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION '355: refusing to record 331–343; % expected object(s) not in place: %',
      array_length(missing, 1), array_to_string(missing, '; ');
  END IF;

  -- ---- Preflight: no placeholder version is held by another name ----

  FOR i IN 1 .. array_length(rec_versions, 1) LOOP
    SELECT name INTO taken_name
    FROM supabase_migrations.schema_migrations
    WHERE version = rec_versions[i];
    IF FOUND AND taken_name IS DISTINCT FROM rec_names[i] THEN
      RAISE EXCEPTION '355: version % is already recorded as %, not %',
        rec_versions[i], coalesce(taken_name, '(no name)'), rec_names[i];
    END IF;
  END LOOP;

  -- ---- Record history rows only ----

  FOR i IN 1 .. array_length(rec_versions, 1) LOOP
    INSERT INTO supabase_migrations.schema_migrations (version, name)
    SELECT rec_versions[i], rec_names[i]
    WHERE NOT EXISTS (
      SELECT 1 FROM supabase_migrations.schema_migrations
      WHERE version = rec_versions[i] OR name = rec_names[i]
    );
    IF FOUND THEN
      n_inserted := n_inserted + 1;
    END IF;
  END LOOP;

  RAISE NOTICE '355: recorded % of % migration(s); the rest were already recorded',
    n_inserted, array_length(rec_versions, 1);
END $$;
