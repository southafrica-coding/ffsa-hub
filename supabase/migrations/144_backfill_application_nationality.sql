-- ────────────────────────────────────────────────────────────
-- 144 · Backfill nationality from application answers (normalised)
-- ────────────────────────────────────────────────────────────
-- Applications submitted through the AUTHENTICATED (portal) flow before the
-- system fields were enforced never populated application_responses.applicant_info.
-- Those submissions stored the applicant's typed nationality as an ordinary
-- free-text ANSWER to a "Nationality…" question, so the dashboard showed them
-- as "Not recorded".
--
-- The recovered values are messy — a mix of ISO-2 codes (US, ZA, NO, CA, DE,
-- FI, LR), other-language / demonym spellings (Deutschland, german/German) and
-- clean country names (Australia, Germany). We normalise them to the canonical
-- country_tiers names so citizenship groups correctly and the fee tier resolves.
-- Values that map to no known country are left untouched (still "Not recorded")
-- rather than written as junk.
--
-- IDEMPOTENT and CONSERVATIVE: only writes where the target is blank; never
-- overwrites an existing value. Safe to re-run. Mapping derived from the live
-- data on 2026-07-29; extend the VALUES list if new raw spellings appear.
-- ────────────────────────────────────────────────────────────

BEGIN;

-- 1) Recover + normalise nationality onto each response's applicant_info.
WITH mapping(raw_lower, country_name) AS (
  VALUES
    ('us', 'United States of America'),
    ('usa', 'United States of America'),
    ('united states', 'United States of America'),
    ('united states of america', 'United States of America'),
    ('za', 'South Africa'),
    ('south africa', 'South Africa'),
    ('no', 'Norway'),
    ('norway', 'Norway'),
    ('ca', 'Canada'),
    ('canada', 'Canada'),
    ('de', 'Germany'),
    ('deutschland', 'Germany'),
    ('german', 'Germany'),
    ('germany', 'Germany'),
    ('fi', 'Finland'),
    ('finland', 'Finland'),
    ('lr', 'Liberia'),
    ('liberia', 'Liberia'),
    ('nz', 'New Zealand'),
    ('new zealand', 'New Zealand'),
    ('nl', 'Netherlands'),
    ('netherlands', 'Netherlands'),
    ('australia', 'Australia')
),
recovered AS (
  SELECT DISTINCT ON (ar.id)
    ar.id AS response_id,
    -- Prefer the explicit mapping; fall back to an exact country_tiers match.
    coalesce(m.country_name, ct.country_name) AS nationality
  FROM public.application_responses ar
  CROSS JOIN LATERAL jsonb_array_elements(ar.answers) AS a(value)
  LEFT JOIN mapping m
    ON m.raw_lower = lower(btrim(a.value->>'answer'))
  LEFT JOIN public.country_tiers ct
    ON lower(btrim(ct.country_name)) = lower(btrim(a.value->>'answer'))
  WHERE btrim(coalesce(ar.applicant_info->>'nationality', '')) = ''
    AND a.value->>'question_label' ILIKE '%national%'
    AND btrim(coalesce(a.value->>'answer', '')) <> ''
    AND coalesce(m.country_name, ct.country_name) IS NOT NULL
  ORDER BY ar.id
)
UPDATE public.application_responses ar
SET applicant_info = coalesce(ar.applicant_info, '{}'::jsonb)
      || jsonb_build_object('nationality', r.nationality)
FROM recovered r
WHERE ar.id = r.response_id
  AND btrim(coalesce(ar.applicant_info->>'nationality', '')) = '';

-- 2) Mirror the (now normalised) nationality onto blank user profiles, so the
--    rest of the Hub benefits. Reads back from applicant_info populated above —
--    also picks up already-clean nationalities from public applications.
WITH per_user AS (
  SELECT DISTINCT ON (ar.user_id)
    ar.user_id,
    ar.applicant_info->>'nationality' AS nationality
  FROM public.application_responses ar
  WHERE ar.user_id IS NOT NULL
    AND btrim(coalesce(ar.applicant_info->>'nationality', '')) <> ''
  ORDER BY ar.user_id, ar.submitted_at DESC NULLS LAST
)
UPDATE public.users u
SET nationality = p.nationality
FROM per_user p
WHERE u.id = p.user_id
  AND btrim(coalesce(u.nationality, '')) = '';

COMMIT;
