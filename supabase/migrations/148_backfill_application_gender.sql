-- ────────────────────────────────────────────────────────────
-- 148 · Backfill gender from application answers (normalised)
-- ────────────────────────────────────────────────────────────
-- Gender is asked on every training program's application form, but as an
-- ordinary per-program QUESTION rather than a system field — so the answer
-- lived only in application_responses.answers and was never copied onto
-- applicant_info. The demographics dashboard reads gender from
-- applicant_info.gender (falling back to users.gender), so most of the
-- population showed as "Not recorded" even though the data existed.
--
-- This mirrors migration 144 (nationality). Two steps:
--   1) Recover + normalise the gender answer onto applicant_info.gender.
--   2) Mirror the (now normalised) value onto blank users.gender profiles.
-- A third step tidies existing users.gender casing ("Male" -> "male") so the
-- stored values match the canonical keys the dashboard buckets by.
--
-- Normalisation matches normaliseGender() in src/lib/schools/demographics.ts —
-- keep the two in sync. Answers that map to no known value are left untouched
-- (still "Not recorded") rather than written as junk.
--
-- IDEMPOTENT and CONSERVATIVE: only writes where the target is blank (steps 1 &
-- 2) or where casing actually differs (step 3); never overwrites a real value.
-- Safe to re-run.
-- ────────────────────────────────────────────────────────────

BEGIN;

-- 1) Recover + normalise gender onto each response's applicant_info.
--    The question is a normal program question, so match by label containing
--    "gender" and only keep answers that map to a canonical value.
WITH mapped AS (
  SELECT
    ar.id AS response_id,
    CASE lower(btrim(a.value->>'answer'))
      WHEN 'male' THEN 'male'
      WHEN 'm' THEN 'male'
      WHEN 'man' THEN 'male'
      WHEN 'female' THEN 'female'
      WHEN 'f' THEN 'female'
      WHEN 'woman' THEN 'female'
      WHEN 'prefer not to say' THEN 'prefer_not_to_say'
      WHEN 'prefer_not_to_say' THEN 'prefer_not_to_say'
      WHEN 'prefer not to answer' THEN 'prefer_not_to_say'
      WHEN 'unspecified' THEN 'prefer_not_to_say'
      ELSE NULL
    END AS gender
  FROM public.application_responses ar
  CROSS JOIN LATERAL jsonb_array_elements(ar.answers) AS a(value)
  WHERE btrim(coalesce(ar.applicant_info->>'gender', '')) = ''
    AND a.value->>'question_label' ILIKE '%gender%'
    AND btrim(coalesce(a.value->>'answer', '')) <> ''
),
recovered AS (
  SELECT DISTINCT ON (response_id) response_id, gender
  FROM mapped
  WHERE gender IS NOT NULL
  ORDER BY response_id
)
UPDATE public.application_responses ar
SET applicant_info = coalesce(ar.applicant_info, '{}'::jsonb)
      || jsonb_build_object('gender', r.gender)
FROM recovered r
WHERE ar.id = r.response_id
  AND btrim(coalesce(ar.applicant_info->>'gender', '')) = '';

-- 2) Mirror the (now normalised) gender onto blank user profiles, so the rest
--    of the Hub benefits. Reads back from applicant_info populated above.
WITH per_user AS (
  SELECT DISTINCT ON (ar.user_id)
    ar.user_id,
    ar.applicant_info->>'gender' AS gender
  FROM public.application_responses ar
  WHERE ar.user_id IS NOT NULL
    AND btrim(coalesce(ar.applicant_info->>'gender', '')) <> ''
  ORDER BY ar.user_id, ar.submitted_at DESC NULLS LAST
)
UPDATE public.users u
SET gender = p.gender
FROM per_user p
WHERE u.id = p.user_id
  AND btrim(coalesce(u.gender, '')) = '';

-- 3) Normalise casing on existing users.gender ("Male"/"Female" -> lowercase),
--    so stored values match the canonical dashboard keys. Only rows whose value
--    actually changes are touched.
UPDATE public.users
SET gender = CASE lower(btrim(gender))
      WHEN 'male' THEN 'male'
      WHEN 'female' THEN 'female'
      WHEN 'prefer not to say' THEN 'prefer_not_to_say'
      WHEN 'prefer_not_to_say' THEN 'prefer_not_to_say'
      ELSE gender
    END
WHERE gender IS NOT NULL
  AND gender <> CASE lower(btrim(gender))
      WHEN 'male' THEN 'male'
      WHEN 'female' THEN 'female'
      WHEN 'prefer not to say' THEN 'prefer_not_to_say'
      WHEN 'prefer_not_to_say' THEN 'prefer_not_to_say'
      ELSE gender
    END;

COMMIT;
