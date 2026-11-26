-- Undo migration 417 (P&W songwriting) in one transaction.
-- Run on prod only with Jack's explicit OK, and only after the export
-- below. Drops the view, the five pw_* tables with their rows, and the
-- access helper. Touches nothing from 318–321 or 416.
--
-- Export before this runs. From psql:
--   \copy (SELECT * FROM public.pw_nations) TO 'pw_nations.csv' CSV HEADER
--   \copy (SELECT * FROM public.pw_songwriting_trainings) TO 'pw_songwriting_trainings.csv' CSV HEADER
--   \copy (SELECT * FROM public.pw_training_facilitators) TO 'pw_training_facilitators.csv' CSV HEADER
--   \copy (SELECT * FROM public.pw_songs) TO 'pw_songs.csv' CSV HEADER
--   \copy (SELECT * FROM public.pw_song_writers) TO 'pw_song_writers.csv' CSV HEADER

BEGIN;

DROP VIEW IF EXISTS public.pw_songwriting_totals;

-- Children first, no CASCADE: anything unexpected that depends on these
-- tables stops the rollback.
DROP TABLE IF EXISTS public.pw_song_writers;
DROP TABLE IF EXISTS public.pw_songs;
DROP TABLE IF EXISTS public.pw_training_facilitators;
DROP TABLE IF EXISTS public.pw_songwriting_trainings;
DROP TABLE IF EXISTS public.pw_nations;

DROP FUNCTION IF EXISTS public.pw_can_access_songwriting();

COMMIT;
