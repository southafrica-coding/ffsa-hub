-- ============================================================
-- FFSA Hub — Migration 309: reject placeholder application identity
-- ============================================================
-- The public apply route used to insert applicant_email
-- 'unknown@applicant.local' when a school's form had no email question,
-- and it stored no first or last name. The applicants list then rendered
-- the missing JSON keys as the words "undefined undefined".
--
-- This CHECK is a backstop for new writes. It does not require a name or
-- an email to be present: logged-in applications keep the name on users,
-- and applicant_info often holds only nationality, home country, and
-- gender. A NOT NULL name check would fail the next status update on
-- almost every existing row.
--
-- NOT VALID so the junk rows already stored (the placeholder address, and
-- any name that literally starts with "undefined") do not abort this
-- migration. Postgres still enforces the check on later INSERT and UPDATE.
-- Updating one of those junk rows (changing its status, for example) will
-- fail until the email and name are corrected or the row is deleted.
-- Do not VALIDATE this constraint until that cleanup has happened.
--
-- 307 and 308 are reserved by other work. Apply by hand in the Supabase
-- SQL editor. Idempotent. Do not run this against production from a script.
--
-- lock_timeout so a busy application_responses table fails this script
-- in a few seconds instead of waiting on a lock held by a live request.
-- ============================================================

SET lock_timeout = '5s';

ALTER TABLE public.application_responses
  DROP CONSTRAINT IF EXISTS application_responses_applicant_identity_chk;

ALTER TABLE public.application_responses
  ADD CONSTRAINT application_responses_applicant_identity_chk
  CHECK (
    (
      applicant_email IS NULL
      OR lower(btrim(applicant_email)) <> 'unknown@applicant.local'
    )
    AND (
      applicant_info IS NULL
      OR (
        btrim(coalesce(applicant_info->>'first_name', '')) NOT ILIKE 'undefined%'
        AND btrim(coalesce(applicant_info->>'last_name', '')) NOT ILIKE 'undefined%'
      )
    )
  ) NOT VALID;

COMMENT ON CONSTRAINT application_responses_applicant_identity_chk
  ON public.application_responses IS
  'Rejects the public-apply placeholder email and names that start with undefined. NOT VALID: existing junk rows are left in place and will fail on UPDATE until cleaned up.';

-- Read-only checks. Do not run the statements above until you mean to;
-- these two SELECTs are safe to run on production as they are.
--
-- Schools whose form is missing a name question or an email question.
-- Nationality and home country do not count.
--
-- SELECT p.id, p.name, p.code,
--   bool_or(
--     coalesce(q.system_key, '') NOT IN ('nationality', 'home_country')
--     AND q.type IS DISTINCT FROM 'section_header'
--     AND q.label ILIKE '%name%'
--     AND q.label NOT ILIKE '%email%'
--   ) AS has_name_question,
--   bool_or(
--     coalesce(q.system_key, '') NOT IN ('nationality', 'home_country')
--     AND q.type IS DISTINCT FROM 'section_header'
--     AND (q.type = 'email' OR q.label ILIKE '%email%')
--   ) AS has_email_question
-- FROM public.programs p
-- LEFT JOIN public.application_questions q ON q.program_id = p.id
-- GROUP BY p.id, p.name, p.code
-- HAVING
--   bool_or(
--     coalesce(q.system_key, '') NOT IN ('nationality', 'home_country')
--     AND q.type IS DISTINCT FROM 'section_header'
--     AND q.label ILIKE '%name%'
--     AND q.label NOT ILIKE '%email%'
--   ) IS NOT TRUE
--   OR bool_or(
--     coalesce(q.system_key, '') NOT IN ('nationality', 'home_country')
--     AND q.type IS DISTINCT FROM 'section_header'
--     AND (q.type = 'email' OR q.label ILIKE '%email%')
--   ) IS NOT TRUE
-- ORDER BY p.name;
--
-- Applications that stored the placeholder, or a name starting with "undefined".
-- The words "undefined undefined" on the applicants list are not a stored
-- column: they are missing applicant_info.first_name / last_name rendered
-- by string interpolation. The second query finds those rows.
--
-- SELECT ar.id, ar.program_id, p.name AS program_name, ar.status,
--        ar.applicant_email,
--        ar.applicant_info->>'first_name' AS first_name,
--        ar.applicant_info->>'last_name' AS last_name,
--        ar.submitted_at
-- FROM public.application_responses ar
-- LEFT JOIN public.programs p ON p.id = ar.program_id
-- WHERE lower(btrim(coalesce(ar.applicant_email, ''))) = 'unknown@applicant.local'
--    OR btrim(coalesce(ar.applicant_info->>'first_name', '')) ILIKE 'undefined%'
--    OR btrim(coalesce(ar.applicant_info->>'last_name', '')) ILIKE 'undefined%'
-- ORDER BY ar.submitted_at DESC;
--
-- SELECT ar.id, ar.program_id, ar.status, ar.applicant_email, ar.applicant_info
-- FROM public.application_responses ar
-- WHERE ar.user_id IS NULL
--   AND ar.applicant_info IS NOT NULL
--   AND btrim(coalesce(ar.applicant_info->>'first_name', '')) = ''
--   AND btrim(coalesce(ar.applicant_info->>'last_name', '')) = '';
