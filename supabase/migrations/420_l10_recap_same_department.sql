-- 420: L10 auto-headline recaps stay inside one department.
--
-- 416 gave l10_headlines.recap_of_meeting_id a plain FK to l10_meetings(id),
-- so service_role could point an auto recap at another department's
-- meeting. This swaps it for a composite same-department FK, the same
-- pattern as l10_teams.recap_source_team_id:
--
--   l10_headlines (recap_of_meeting_id, department_id)
--     → l10_meetings (id, department_id)  ON DELETE SET NULL (recap_of_meeting_id)
--
-- Neither table had a department column, so both get department_id:
--   * NOT NULL, filled from the row's team by a BEFORE INSERT / UPDATE OF
--     team_id, department_id trigger (callers never set it; a value they
--     send is overwritten with the team's department);
--   * pinned to the team by a composite FK (team_id, department_id) →
--     l10_teams (id, department_id) ON UPDATE CASCADE, so a team that
--     moves department carries its meetings and headlines with it.
--     (A team paired for recaps already cannot move: the 416 pairing FK
--     blocks it, and the recap FK below blocks it the same way.)
-- plus UNIQUE (id, department_id) on l10_meetings for the FK target.
--
-- New FKs are added NOT VALID, then VALIDATEd. Every step is guarded, so
-- the file is safe to run twice. No RLS, grant or helper changes.
-- Rollback: supabase/rollbacks/420_l10_recap_same_department_rollback.sql

-- ────────────────────────────────────────────────────────────
-- 1. Fill department_id from the team
-- ────────────────────────────────────────────────────────────
-- SECURITY DEFINER: a plain lookup of the team's department that must
-- work for service_role, signed-in callers (whose RLS on l10_teams the
-- insert has already passed) and FK cascades alike. Raises 23503 when
-- the team does not exist, the same code the team_id FK would give.
CREATE OR REPLACE FUNCTION public.l10_set_department_from_team()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  dept uuid;
BEGIN
  SELECT t.department_id INTO dept
    FROM public.l10_teams t
   WHERE t.id = NEW.team_id;
  IF dept IS NULL THEN
    RAISE EXCEPTION 'l10 team % not found', NEW.team_id
      USING ERRCODE = '23503';
  END IF;
  NEW.department_id := dept;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.l10_set_department_from_team() FROM PUBLIC, anon, authenticated;

-- ────────────────────────────────────────────────────────────
-- 2. l10_meetings.department_id + UNIQUE (id, department_id)
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.l10_meetings ADD COLUMN IF NOT EXISTS department_id uuid;

UPDATE public.l10_meetings m
   SET department_id = t.department_id
  FROM public.l10_teams t
 WHERE t.id = m.team_id
   AND m.department_id IS DISTINCT FROM t.department_id;

ALTER TABLE public.l10_meetings ALTER COLUMN department_id SET NOT NULL;

DROP TRIGGER IF EXISTS l10_meetings_set_department ON public.l10_meetings;
CREATE TRIGGER l10_meetings_set_department
  BEFORE INSERT OR UPDATE OF team_id, department_id ON public.l10_meetings
  FOR EACH ROW EXECUTE FUNCTION public.l10_set_department_from_team();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.l10_meetings'::regclass
                    AND conname = 'l10_meetings_team_department_fkey') THEN
    ALTER TABLE public.l10_meetings
      ADD CONSTRAINT l10_meetings_team_department_fkey
      FOREIGN KEY (team_id, department_id)
      REFERENCES public.l10_teams (id, department_id)
      ON UPDATE CASCADE
      NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.l10_meetings'::regclass
                    AND conname = 'l10_meetings_id_department_key') THEN
    ALTER TABLE public.l10_meetings
      ADD CONSTRAINT l10_meetings_id_department_key UNIQUE (id, department_id);
  END IF;
END $$;

ALTER TABLE public.l10_meetings VALIDATE CONSTRAINT l10_meetings_team_department_fkey;

CREATE INDEX IF NOT EXISTS l10_meetings_team_department_idx
  ON public.l10_meetings (team_id, department_id);

COMMENT ON COLUMN public.l10_meetings.department_id IS
  'The team''s department (staff_ministries.id). Filled from team_id by trigger; never set it.';

-- ────────────────────────────────────────────────────────────
-- 3. l10_headlines.department_id
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.l10_headlines ADD COLUMN IF NOT EXISTS department_id uuid;

UPDATE public.l10_headlines h
   SET department_id = t.department_id
  FROM public.l10_teams t
 WHERE t.id = h.team_id
   AND h.department_id IS DISTINCT FROM t.department_id;

ALTER TABLE public.l10_headlines ALTER COLUMN department_id SET NOT NULL;

-- Sorts after l10_headlines_auto_guard, which does not look at
-- department_id; signed-in callers cannot change it anyway (overwritten).
DROP TRIGGER IF EXISTS l10_headlines_set_department ON public.l10_headlines;
CREATE TRIGGER l10_headlines_set_department
  BEFORE INSERT OR UPDATE OF team_id, department_id ON public.l10_headlines
  FOR EACH ROW EXECUTE FUNCTION public.l10_set_department_from_team();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.l10_headlines'::regclass
                    AND conname = 'l10_headlines_team_department_fkey') THEN
    ALTER TABLE public.l10_headlines
      ADD CONSTRAINT l10_headlines_team_department_fkey
      FOREIGN KEY (team_id, department_id)
      REFERENCES public.l10_teams (id, department_id)
      ON UPDATE CASCADE
      NOT VALID;
  END IF;
END $$;

ALTER TABLE public.l10_headlines VALIDATE CONSTRAINT l10_headlines_team_department_fkey;

CREATE INDEX IF NOT EXISTS l10_headlines_team_department_idx
  ON public.l10_headlines (team_id, department_id);

COMMENT ON COLUMN public.l10_headlines.department_id IS
  'The team''s department (staff_ministries.id). Filled from team_id by trigger; never set it.';

-- ────────────────────────────────────────────────────────────
-- 4. recap_of_meeting_id: plain FK → same-department composite FK
-- ────────────────────────────────────────────────────────────
DO $$
DECLARE
  c record;
  col smallint;
BEGIN
  SELECT attnum INTO col FROM pg_attribute
   WHERE attrelid = 'public.l10_headlines'::regclass AND attname = 'recap_of_meeting_id';

  -- Drop the single-column FK from 416 (whatever its name).
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.l10_headlines'::regclass
       AND contype = 'f'
       AND conkey = ARRAY[col]
  LOOP
    EXECUTE format('ALTER TABLE public.l10_headlines DROP CONSTRAINT %I', c.conname);
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.l10_headlines'::regclass
                    AND conname = 'l10_headlines_recap_same_department_fkey') THEN
    ALTER TABLE public.l10_headlines
      ADD CONSTRAINT l10_headlines_recap_same_department_fkey
      FOREIGN KEY (recap_of_meeting_id, department_id)
      REFERENCES public.l10_meetings (id, department_id)
      ON DELETE SET NULL (recap_of_meeting_id)
      NOT VALID;
  END IF;
END $$;

ALTER TABLE public.l10_headlines VALIDATE CONSTRAINT l10_headlines_recap_same_department_fkey;

COMMENT ON COLUMN public.l10_headlines.recap_of_meeting_id IS
  'The paired team''s ended meeting this auto headline recaps; must be in the same department (composite FK). Set exactly on auto rows when written; cleared if that meeting is deleted.';
