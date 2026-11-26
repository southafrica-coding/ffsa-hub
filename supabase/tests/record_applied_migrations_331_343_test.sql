-- Disposable check for migration 355. Not a migration.
-- Stubs supabase_migrations.schema_migrations and empty stand-ins for
-- every object 331–343 create, then runs 355 and checks that it
-- refuses (and records nothing) when an object is missing, records
-- the 13 rows when everything is there, and is a no-op on re-run.
--
-- Run from the repo root (the migration is read by relative path):
--
--   dropdb --if-exists record_331_343 && createdb record_331_343
--   psql -v ON_ERROR_STOP=1 -d record_331_343 -f supabase/tests/record_applied_migrations_331_343_test.sql
--
-- Never point this at a shared or hosted database.

\set ON_ERROR_STOP 1
SET client_min_messages = warning;

\set mig `cat supabase/migrations/355_record_applied_migrations_331_343.sql`
SELECT set_config('test.mig', :'mig', false) \gset

-- ---- Stub tracking table, with the rows prod already has around the gap ----

CREATE SCHEMA supabase_migrations;
CREATE TABLE supabase_migrations.schema_migrations (
  version text PRIMARY KEY,
  statements text[],
  name text
);
INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES
  ('20261117140540', '329_missio_org_phase0'),
  ('20261117142219', '330_contact_labels_select_staff'),
  ('20261119133212', '350_fleet_schema'),
  ('20261122193041', '344_users_color_scheme');

-- ---- Stub objects ----

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'house_churches', 'house_church_members', 'missio_import_review',
    'connect_responses', 'missio_followups', 'missio_followup_stage_history',
    'availability_requests', 'availability_tokens', 'availability_responses',
    'missio_teams', 'missio_team_leaders', 'missio_team_members',
    'enrollment_staff', 'student_checkins', 'student_checkin_private',
    'today_dismissals', 'missio_coach_assignments', 'missio_feedback_links',
    'missio_house_feedback', 'missio_placements', 'missio_households',
    'missio_household_members', 'missio_next_leaders', 'missio_care_requests',
    -- pre-existing tables that 334/335 put policies on
    'enrollments', 'activity_events'
  ] LOOP
    EXECUTE format('CREATE TABLE public.%I (id int)', t);
  END LOOP;

  FOREACH t IN ARRAY ARRAY[
    'missio_member_status', 'missio_followup_effective', 'missio_not_in_house'
  ] LOOP
    EXECUTE format('CREATE VIEW public.%I AS SELECT 1 AS x', t);
  END LOOP;

  FOREACH t IN ARRAY ARRAY[
    'has_org_role', 'has_org_role_id', 'is_missio_member',
    'guard_house_church_member', 'guard_missio_import_review_resolve',
    'missio_phone_e164', 'missio_phone_e164_try', 'missio_fold_phone_digits',
    'assign_missio_connect_match', 'attach_missio_connect_response',
    'decline_missio_connect_match', 'guard_missio_connect_contact',
    'link_missio_connect_match', 'mark_missio_followup_joined',
    'missio_followup_lock', 'pin_missio_followup_changed_by',
    'record_missio_followup_stage', 'set_connect_response_phone_e164',
    'missio_availability_contact_on_roster', 'availability_dates_in_range',
    'availability_request_stamp_creator', 'availability_response_guard',
    'missio_volunteer_contact_in_org', 'missio_volunteer_org_is_missio',
    'is_walking_with', 'walking_with_enrollment_ids', 'is_own_enrollment',
    'is_school_staff_for_enrollment', 'can_manage_checkin',
    'can_read_checkin_private', 'is_checkin_author', 'my_checkin_notes',
    'student_checkins_guard', 'enrollment_staff_mirror_assigned',
    'training_enrollment_program', 'training_touch_updated_at',
    'save_student_checkin', 'missio_my_contact_id', 'missio_my_house_ids',
    'missio_led_house_ids', 'missio_coached_house_ids', 'missio_my_household_ids'
  ] LOOP
    EXECUTE format('CREATE FUNCTION public.%I() RETURNS int LANGUAGE sql AS ''SELECT 1''', t);
  END LOOP;

  FOREACH t IN ARRAY ARRAY[
    'house_churches|Pastors can read house churches',
    'house_churches|Pastors can insert house churches',
    'house_churches|Pastors can update house churches',
    'house_church_members|Pastors can read house church members',
    'house_church_members|Pastors can insert house church members',
    'house_church_members|Pastors can update house church members',
    'missio_import_review|Pastors can read import review',
    'missio_import_review|Pastors can resolve import review',
    'connect_responses|Pastors can read connect responses',
    'connect_responses|Pastors can insert manual connect responses',
    'connect_responses|Pastors can update connect responses',
    'missio_followups|Pastors can read followups',
    'missio_followups|Pastors can insert followups',
    'missio_followups|Pastors can update followups',
    'missio_followup_stage_history|Pastors can read followup history',
    'missio_followup_stage_history|Pastors can insert followup notes',
    'missio_teams|Missio pastors manage teams',
    'missio_team_leaders|Missio pastors manage team leaders',
    'missio_team_members|Missio pastors manage team members',
    'availability_requests|Missio pastors read availability requests',
    'availability_requests|Missio pastors insert availability requests',
    'availability_requests|Missio pastors delete availability requests',
    'availability_responses|Missio pastors read availability responses',
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
    'activity_events|Staff can read activity events',
    'missio_coach_assignments|Pastors can read coach assignments',
    'missio_coach_assignments|Pastors can add coach assignments',
    'missio_coach_assignments|Pastors can end coach assignments',
    'house_churches|Coaches and leaders can read their houses',
    'house_church_members|Coaches and leaders can read their house members',
    'missio_coach_assignments|Coaches and leaders can read their house coach',
    'house_church_members|Coaches can update members of their houses',
    'missio_house_feedback|Pastors can read house feedback',
    'missio_house_feedback|Coaches and leaders can read their house feedback',
    'missio_placements|Pastors can read placements',
    'missio_placements|Coaches and leaders can read placements into their houses',
    'missio_households|Pastors manage households',
    'missio_household_members|Pastors manage household members',
    'missio_households|House leaders and coaches read their households',
    'missio_household_members|House leaders and coaches read their household members',
    'missio_next_leaders|Pastors manage next leaders',
    'missio_next_leaders|Coaches and leaders read next leaders in their houses',
    'missio_next_leaders|Coaches and leaders nominate in their houses',
    'missio_next_leaders|Coaches and leaders move next leaders in their houses',
    'missio_care_requests|Pastors read care requests',
    'missio_care_requests|Pastors update care requests',
    'missio_care_requests|Pastors log care requests'
  ] LOOP
    EXECUTE format('CREATE POLICY %I ON public.%I USING (true)',
                   split_part(t, '|', 2), split_part(t, '|', 1));
  END LOOP;
END $$;

-- ---- Helpers ----

CREATE TEMP TABLE results (n serial, label text, ok boolean, detail text);

CREATE FUNCTION pg_temp.run_mig() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE current_setting('test.mig');
END $$;

-- Runs 355 expecting a refusal whose message matches pattern.
CREATE FUNCTION pg_temp.expect_refusal(label text, pattern text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  msg text;
BEGIN
  BEGIN
    PERFORM pg_temp.run_mig();
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
  END;
  INSERT INTO results (label, ok, detail)
  VALUES (label, msg IS NOT NULL AND msg ~ pattern, coalesce(msg, 'no error raised'));
END $$;

CREATE FUNCTION pg_temp.check(label text, ok boolean, detail text DEFAULT NULL)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO results (label, ok, detail) VALUES (label, ok, detail);
$$;

CREATE FUNCTION pg_temp.recorded() RETURNS int LANGUAGE sql AS $$
  SELECT count(*)::int FROM supabase_migrations.schema_migrations
  WHERE name ~ '^3(3[1-9]|4[0-3])_';
$$;

-- ---- 1. A required table is missing: refuse, record nothing ----

ALTER TABLE public.missio_care_requests RENAME TO missio_care_requests_hidden;
SELECT pg_temp.expect_refusal('missing table refuses',
                              'table public\.missio_care_requests');
SELECT pg_temp.check('missing table records nothing', pg_temp.recorded() = 0,
                     pg_temp.recorded()::text);
ALTER TABLE public.missio_care_requests_hidden RENAME TO missio_care_requests;

-- ---- 2. A required function is missing: refuse ----

ALTER FUNCTION public.save_student_checkin() RENAME TO save_student_checkin_hidden;
SELECT pg_temp.expect_refusal('missing function refuses',
                              'function public\.save_student_checkin');
ALTER FUNCTION public.save_student_checkin_hidden() RENAME TO save_student_checkin;

-- ---- 3. A required policy is missing: refuse ----

DROP POLICY "Staff can read activity events" ON public.activity_events;
SELECT pg_temp.expect_refusal('missing policy refuses',
                              'Staff can read activity events');
CREATE POLICY "Staff can read activity events" ON public.activity_events USING (true);

-- ---- 4. The policy 335 drops is still there: refuse ----

CREATE POLICY "Auth users can read activity events" ON public.activity_events USING (true);
SELECT pg_temp.expect_refusal('old 335 policy present refuses',
                              'should have been dropped by 335');
DROP POLICY "Auth users can read activity events" ON public.activity_events;

-- ---- 5. A placeholder version is taken by another name: refuse ----

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20261122194107', 'something_else');
SELECT pg_temp.expect_refusal('placeholder collision refuses',
                              'version 20261122194107 is already recorded as something_else');
SELECT pg_temp.check('collision records nothing', pg_temp.recorded() = 0,
                     pg_temp.recorded()::text);
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261122194107';

-- ---- 6. One file already recorded under another version: skipped ----

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20261117150000', '331_missio_house_churches');

-- ---- 7. Everything in place: records the other 12 ----

SELECT pg_temp.run_mig();
SELECT pg_temp.check('all present records 13 names', pg_temp.recorded() = 13,
                     pg_temp.recorded()::text);
SELECT pg_temp.check('331 kept its existing version, no duplicate',
  (SELECT array_agg(version) FROM supabase_migrations.schema_migrations
   WHERE name = '331_missio_house_churches') = ARRAY['20261117150000']);
SELECT pg_temp.check('331 placeholder not used',
  NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations
              WHERE version = '20261122194101'));
SELECT pg_temp.check('versions and names pair up',
  (SELECT count(*) FROM supabase_migrations.schema_migrations s
   JOIN (VALUES
     ('20261122194102', '332_missio_connect_funnel'),
     ('20261122194103', '333_missio_volunteer_availability'),
     ('20261122194104', '334_training_foundations'),
     ('20261122194105', '335_activity_events_select_staff'),
     ('20261122194106', '336_save_student_checkin'),
     ('20261122194107', '337_missio_coaches'),
     ('20261122194108', '338_missio_roles'),
     ('20261122194109', '339_missio_house_feedback'),
     ('20261122194110', '340_missio_placements'),
     ('20261122194111', '341_missio_households'),
     ('20261122194112', '342_missio_next_leaders'),
     ('20261122194113', '343_missio_care')
   ) AS w(version, name) USING (version, name)) = 12);
SELECT pg_temp.check('existing rows untouched',
  (SELECT count(*) FROM supabase_migrations.schema_migrations
   WHERE version IN ('20261117140540', '20261117142219',
                     '20261119133212', '20261122193041')) = 4);

-- ---- 8. Re-run is a no-op ----

SELECT pg_temp.run_mig();
SELECT pg_temp.check('re-run adds nothing',
  (SELECT count(*) FROM supabase_migrations.schema_migrations) = 4 + 13);

-- ---- Report ----

DO $$
DECLARE
  rec record;
  n_fail int;
BEGIN
  SELECT count(*) INTO n_fail FROM results WHERE NOT ok;
  FOR rec IN SELECT * FROM results ORDER BY n LOOP
    RAISE WARNING '% % %', CASE WHEN rec.ok THEN 'ok  ' ELSE 'FAIL' END,
      rec.n, rec.label;
    IF NOT rec.ok THEN
      RAISE WARNING '       %', rec.detail;
    END IF;
  END LOOP;
  IF n_fail > 0 THEN
    RAISE EXCEPTION 'record_applied_migrations_331_343: % checks failed', n_fail;
  END IF;
  RAISE WARNING 'record_applied_migrations_331_343: all % checks passed',
    (SELECT count(*) FROM results);
END $$;
