-- Undo migration 424 (P&W songwriting v2) in one transaction.
-- Run on prod only with Jack's explicit OK. Run before 417's rollback.
--
-- Guarded: refuses (55000) while any 424 data exists (a lead, a lead
-- event, a nation iso_code or language, or a training_date), so nothing
-- is lost by accident. Export, then clear, first. From psql:
--   \copy (SELECT * FROM public.pw_songwriting_leads) TO 'pw_songwriting_leads.csv' CSV HEADER
--   \copy (SELECT * FROM public.pw_songwriting_lead_events) TO 'pw_songwriting_lead_events.csv' CSV HEADER
--   \copy (SELECT id, slug, iso_code, languages FROM public.pw_nations) TO 'pw_nations_424.csv' CSV HEADER
--   \copy (SELECT id, training_date FROM public.pw_songwriting_trainings WHERE training_date IS NOT NULL) TO 'pw_training_dates.csv' CSV HEADER
-- Clear:
--   DELETE FROM public.pw_songwriting_lead_events; DELETE FROM public.pw_songwriting_leads;
--   UPDATE public.pw_nations SET iso_code = NULL, languages = '{}';
--   UPDATE public.pw_songwriting_trainings SET training_date = NULL WHERE training_date IS NOT NULL;
-- Touches nothing from 417 except the three added columns.

BEGIN;

DO $$
DECLARE
  n bigint := 0;
BEGIN
  IF to_regclass('public.pw_songwriting_leads') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.pw_songwriting_leads' INTO n;
  END IF;
  IF n = 0 AND to_regclass('public.pw_songwriting_lead_events') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.pw_songwriting_lead_events' INTO n;
  END IF;
  IF n = 0 AND EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_schema = 'public' AND table_name = 'pw_nations' AND column_name = 'iso_code') THEN
    EXECUTE 'SELECT count(*) FROM public.pw_nations WHERE iso_code IS NOT NULL OR cardinality(languages) > 0' INTO n;
  END IF;
  IF n = 0 AND EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_schema = 'public' AND table_name = 'pw_songwriting_trainings' AND column_name = 'training_date') THEN
    EXECUTE 'SELECT count(*) FROM public.pw_songwriting_trainings WHERE training_date IS NOT NULL' INTO n;
  END IF;
  IF n > 0 THEN
    RAISE EXCEPTION '424 rollback refused: 424 data still exists (leads, lead events, nation iso_code/languages or training_date). Export and clear it first (see the header).'
      USING ERRCODE = '55000';
  END IF;
END $$;

-- Children first, no CASCADE.
DROP TABLE IF EXISTS public.pw_songwriting_lead_events;
DROP TABLE IF EXISTS public.pw_songwriting_leads;
DROP FUNCTION IF EXISTS public.pw_songwriting_lead_events_touch_lead();
DROP FUNCTION IF EXISTS public.pw_songwriting_lead_events_guard();
DROP FUNCTION IF EXISTS public.pw_songwriting_leads_guard();
DROP FUNCTION IF EXISTS public.pw_can_delete_lead_event(uuid);

ALTER TABLE IF EXISTS public.pw_songwriting_trainings DROP CONSTRAINT IF EXISTS pw_songwriting_trainings_date_in_month;
ALTER TABLE IF EXISTS public.pw_songwriting_trainings DROP COLUMN IF EXISTS training_date;

DROP INDEX IF EXISTS public.pw_nations_iso_code_key;
ALTER TABLE IF EXISTS public.pw_nations DROP CONSTRAINT IF EXISTS pw_nations_iso_code_format;
ALTER TABLE IF EXISTS public.pw_nations DROP CONSTRAINT IF EXISTS pw_nations_languages_no_blanks;
ALTER TABLE IF EXISTS public.pw_nations DROP COLUMN IF EXISTS iso_code;
ALTER TABLE IF EXISTS public.pw_nations DROP COLUMN IF EXISTS languages;
DROP FUNCTION IF EXISTS public.pw_text_array_no_blanks(text[]);

COMMIT;
