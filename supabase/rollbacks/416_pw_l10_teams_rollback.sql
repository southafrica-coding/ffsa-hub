-- Undo migration 416 (L10 teams) in one transaction.
-- Run on prod only with Jack's explicit OK, and only after the export
-- below. It drops every l10_* table (with their rows), the l10_* helpers
-- and rocks.team_id, and puts 320's four rocks policies and 320's
-- leadership_ministry_rollup back verbatim.
--
-- It refuses to run while any rock still has a team_id: dropping the
-- column would silently turn a team rock into a department rock that
-- every P&W member can read. Move or delete those rocks first, on
-- purpose, after exporting them.
--
-- Export before this runs. From psql, against the database you are
-- rolling back:
--
--   \copy (SELECT * FROM public.rocks WHERE team_id IS NOT NULL) TO 'l10_team_rocks.csv' CSV HEADER
--   \copy (SELECT * FROM public.l10_teams) TO 'l10_teams.csv' CSV HEADER
--   \copy (SELECT * FROM public.l10_team_members) TO 'l10_team_members.csv' CSV HEADER
--   \copy (SELECT * FROM public.l10_meetings) TO 'l10_meetings.csv' CSV HEADER
--   \copy (SELECT * FROM public.l10_meeting_attendees) TO 'l10_meeting_attendees.csv' CSV HEADER
--   \copy (SELECT * FROM public.l10_measurables) TO 'l10_measurables.csv' CSV HEADER
--   \copy (SELECT * FROM public.l10_measurable_values) TO 'l10_measurable_values.csv' CSV HEADER
--   \copy (SELECT * FROM public.l10_todos) TO 'l10_todos.csv' CSV HEADER
--   \copy (SELECT * FROM public.l10_issues) TO 'l10_issues.csv' CSV HEADER
--   \copy (SELECT * FROM public.l10_headlines) TO 'l10_headlines.csv' CSV HEADER

BEGIN;

DO $guard$
DECLARE
  n bigint;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'rocks' AND column_name = 'team_id'
  ) THEN
    EXECUTE 'SELECT count(*) FROM public.rocks WHERE team_id IS NOT NULL' INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION '416 rollback refused: % rock(s) still have a team_id. Export them, then move or delete them first.', n
        USING ERRCODE = '55000';
    END IF;
  END IF;
END
$guard$;

-- 320's rocks policies, exactly as 320 created them.
DROP POLICY IF EXISTS "Ministry readers read rocks" ON public.rocks;
CREATE POLICY "Ministry readers read rocks"
  ON public.rocks FOR SELECT TO authenticated
  USING (public.dept_can_read_rock(staff_ministry_id));

DROP POLICY IF EXISTS "Ministry leaders insert rocks" ON public.rocks;
CREATE POLICY "Ministry leaders insert rocks"
  ON public.rocks FOR INSERT TO authenticated
  WITH CHECK (public.dept_can_write_rock(staff_ministry_id));

DROP POLICY IF EXISTS "Ministry leaders update rocks" ON public.rocks;
CREATE POLICY "Ministry leaders update rocks"
  ON public.rocks FOR UPDATE TO authenticated
  USING (public.dept_can_write_rock(staff_ministry_id))
  WITH CHECK (public.dept_can_write_rock(staff_ministry_id));

DROP POLICY IF EXISTS "Ministry leaders delete rocks" ON public.rocks;
CREATE POLICY "Ministry leaders delete rocks"
  ON public.rocks FOR DELETE TO authenticated
  USING (public.dept_can_write_rock(staff_ministry_id));

-- 320's leadership_ministry_rollup, verbatim, before rocks.team_id goes
-- (the 416 version references that column).
CREATE OR REPLACE VIEW public.leadership_ministry_rollup
WITH (security_invoker = true) AS
SELECT
  m.id AS staff_ministry_id,
  m.slug AS ministry_slug,
  m.name AS ministry_name,
  m.ministry_type,
  m.is_active AS ministry_is_active,
  'rock'::text AS source,
  r.id AS source_id,
  r.title,
  r.status,
  NULL::text AS objective_scope,
  r.owner_user_id,
  r.due_on,
  r.quarter,
  r.description,
  r.notes,
  r.updated_at
FROM public.staff_ministries m
JOIN public.rocks r ON r.staff_ministry_id = m.id
WHERE public.dept_caller_is_active()
  AND (public.is_admin() OR public.dept_is_leadership_reader())
UNION ALL
SELECT
  m.id,
  m.slug,
  m.name,
  m.ministry_type,
  m.is_active,
  'okr_objective'::text,
  o.id,
  o.title,
  'current'::text,
  o.scope::text,
  o.owner_user_id,
  NULL::date,
  NULL::text,
  o.description,
  o.notes,
  o.updated_at
FROM public.staff_ministries m
JOIN public.okr_objectives o
  ON o.staff_ministry_id = m.id
 AND o.is_archived = false
JOIN public.okr_cycles c
  ON c.id = o.cycle_id
 AND c.is_current
WHERE public.dept_caller_is_active()
  AND (public.is_admin() OR public.dept_is_leadership_reader());

COMMENT ON VIEW public.leadership_ministry_rollup IS
  'Leadership roll-up: rocks plus current-cycle OKR objectives on a staff ministry. security_invoker. Not a second OKR store.';

REVOKE ALL ON public.leadership_ministry_rollup FROM PUBLIC, anon;
GRANT SELECT ON public.leadership_ministry_rollup TO authenticated, service_role;

DROP INDEX IF EXISTS public.rocks_team_quarter_idx;
ALTER TABLE public.rocks DROP CONSTRAINT IF EXISTS rocks_team_department_fkey;
ALTER TABLE public.rocks DROP COLUMN IF EXISTS team_id;

-- Children first. No CASCADE, so anything unexpected that depends on
-- these tables stops the rollback instead of being dropped with it.
DROP TABLE IF EXISTS public.l10_headlines;
DROP TABLE IF EXISTS public.l10_issues;
DROP TABLE IF EXISTS public.l10_todos;
DROP TABLE IF EXISTS public.l10_measurable_values;
DROP TABLE IF EXISTS public.l10_measurables;
DROP TABLE IF EXISTS public.l10_meeting_attendees;
DROP TABLE IF EXISTS public.l10_meetings;
DROP TABLE IF EXISTS public.l10_team_members;
DROP TABLE IF EXISTS public.l10_teams;

DROP FUNCTION IF EXISTS public.l10_headlines_auto_guard();
DROP FUNCTION IF EXISTS public.l10_meeting_attendees_rating_guard();
DROP FUNCTION IF EXISTS public.l10_can_rate_attendee(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.l10_segment_timings_valid(jsonb);
DROP FUNCTION IF EXISTS public.l10_can_manage_team(uuid);
DROP FUNCTION IF EXISTS public.l10_can_access_team(uuid);
DROP FUNCTION IF EXISTS public.l10_is_team_member(uuid, boolean);
DROP FUNCTION IF EXISTS public.l10_can_oversee_team(uuid);

COMMIT;
