-- Follow-up. Not a migration. Do not number it and do not run it with 304.
-- Run it by hand in the SQL editor once the build that reads and writes
-- application_admin_notes is the only one live.
--
-- What it does, in one transaction:
--   1. Inserts a notes row for any application whose old column still has
--      text and has no notes row yet (a straggler written after 304).
--   2. Stops, without clearing the column, when the old column and the
--      notes row disagree. updated_at is not a safe way to pick a winner:
--      application_responses.updated_at moves on every update (status,
--      assignment, anything else), and application_admin_notes.updated_at
--      is not bumped when this app saves a note. Copy the text you want
--      to keep into application_admin_notes, then run this script again.
--   3. Sets application_responses.admin_notes to null only when nothing
--      still disagrees. Running it again after that changes nothing.
--
-- Drop the column in a later migration, after this has been applied.

BEGIN;

INSERT INTO public.application_admin_notes (application_response_id, program_id, notes)
SELECT ar.id, ar.program_id, ar.admin_notes
  FROM public.application_responses ar
 WHERE ar.admin_notes IS NOT NULL
   AND btrim(ar.admin_notes) <> ''
   AND NOT EXISTS (
     SELECT 1
       FROM public.application_admin_notes n
      WHERE n.application_response_id = ar.id
   )
ON CONFLICT (application_response_id) DO NOTHING;

-- Review list. Empty when it is safe to clear the column.
SELECT ar.id AS application_response_id,
       ar.admin_notes AS column_note,
       n.notes AS table_note
  FROM public.application_responses ar
  JOIN public.application_admin_notes n
    ON n.application_response_id = ar.id
 WHERE ar.admin_notes IS NOT NULL
   AND btrim(ar.admin_notes) <> ''
   AND ar.admin_notes IS DISTINCT FROM n.notes;

DO $$
DECLARE
  pending integer;
BEGIN
  SELECT count(*) INTO pending
    FROM public.application_responses ar
    JOIN public.application_admin_notes n
      ON n.application_response_id = ar.id
   WHERE ar.admin_notes IS NOT NULL
     AND btrim(ar.admin_notes) <> ''
     AND ar.admin_notes IS DISTINCT FROM n.notes;

  IF pending > 0 THEN
    RAISE EXCEPTION
      '% note(s) on application_responses.admin_notes differ from application_admin_notes. The rows are selected above. Write the text you want to keep into application_admin_notes, then run this script again. The column was not cleared.',
      pending;
  END IF;

  UPDATE public.application_responses
     SET admin_notes = NULL
   WHERE admin_notes IS NOT NULL;
END $$;

COMMIT;
