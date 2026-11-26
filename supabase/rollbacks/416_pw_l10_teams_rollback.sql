-- Undo migration 416 (L10 teams) in one transaction.
-- Run on prod only with Jack's explicit OK, and only after the export
-- below. It drops every l10_* table (with their rows), the l10_* helpers
-- and rocks.team_id, and puts 320's four rocks policies back verbatim.
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

DROP FUNCTION IF EXISTS public.l10_segment_timings_valid(jsonb);
DROP FUNCTION IF EXISTS public.l10_can_manage_team(uuid);
DROP FUNCTION IF EXISTS public.l10_can_access_team(uuid);
DROP FUNCTION IF EXISTS public.l10_is_team_member(uuid, boolean);
DROP FUNCTION IF EXISTS public.l10_can_oversee_team(uuid);

COMMIT;
