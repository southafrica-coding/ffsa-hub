-- ============================================================
-- Backfill applicant_email on application rows from the linked user
-- ============================================================
-- Applications created by a signed-in applicant were stored with only
-- program_id + user_id + answers, leaving application_responses.applicant_email
-- (and applicant_info.email) null. The email lived only on the linked users
-- row, so any flow that didn't follow that join (acceptance) failed with
-- "No email found for this applicant".
--
-- Going forward the API stamps applicant_email at creation time. This backfills
-- existing rows: copy users.email onto every response that has a linked user
-- but no applicant_email of its own. Read-only for rows that already have one.
-- ============================================================

UPDATE public.application_responses AS ar
SET applicant_email = u.email
FROM public.users AS u
WHERE ar.user_id = u.id
  AND u.email IS NOT NULL
  AND (ar.applicant_email IS NULL OR ar.applicant_email = '');
