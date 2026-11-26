-- Rollback for 420_l10_recap_same_department.sql.
-- Puts back 416's plain FK on l10_headlines.recap_of_meeting_id and drops
-- the department_id columns (derived from team_id, so nothing is lost).
-- Safe to run twice. Run before the 416 rollback.

ALTER TABLE IF EXISTS public.l10_headlines
  DROP CONSTRAINT IF EXISTS l10_headlines_recap_same_department_fkey;

DO $$
BEGIN
  IF to_regclass('public.l10_headlines') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint
                      WHERE conrelid = 'public.l10_headlines'::regclass
                        AND conname = 'l10_headlines_recap_of_meeting_id_fkey') THEN
    ALTER TABLE public.l10_headlines
      ADD CONSTRAINT l10_headlines_recap_of_meeting_id_fkey
      FOREIGN KEY (recap_of_meeting_id) REFERENCES public.l10_meetings (id)
      ON DELETE SET NULL
      NOT VALID;
    ALTER TABLE public.l10_headlines VALIDATE CONSTRAINT l10_headlines_recap_of_meeting_id_fkey;
  END IF;
END $$;

COMMENT ON COLUMN public.l10_headlines.recap_of_meeting_id IS
  'The paired team''s ended meeting this auto headline recaps. Set exactly on auto rows when written; cleared if that meeting is deleted.';

DROP TRIGGER IF EXISTS l10_headlines_set_department ON public.l10_headlines;
ALTER TABLE IF EXISTS public.l10_headlines DROP CONSTRAINT IF EXISTS l10_headlines_team_department_fkey;
DROP INDEX IF EXISTS public.l10_headlines_team_department_idx;
ALTER TABLE IF EXISTS public.l10_headlines DROP COLUMN IF EXISTS department_id;

DROP TRIGGER IF EXISTS l10_meetings_set_department ON public.l10_meetings;
ALTER TABLE IF EXISTS public.l10_meetings DROP CONSTRAINT IF EXISTS l10_meetings_id_department_key;
ALTER TABLE IF EXISTS public.l10_meetings DROP CONSTRAINT IF EXISTS l10_meetings_team_department_fkey;
DROP INDEX IF EXISTS public.l10_meetings_team_department_idx;
ALTER TABLE IF EXISTS public.l10_meetings DROP COLUMN IF EXISTS department_id;

DROP FUNCTION IF EXISTS public.l10_set_department_from_team();
