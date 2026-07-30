-- ============================================================
-- FFSA Hub — Migration 145: Seed the "FFSA Family" label
-- ============================================================
-- Seeds a single preset label used to tag everyone who submits a
-- school/volunteer application. When an application is submitted,
-- the applicant is now upserted into the CRM contact base (email-
-- deduped) and tagged with this label, so applicants form one clean
-- segment in Contacts.
--
-- Looked up by its stable slug ('ffsa-family') at submit time; a
-- preset seed avoids a per-request find-or-create race. Points at the
-- default-marketing sending identity seeded in migration 042, matching
-- the other preset labels (migration 050).
-- ============================================================

INSERT INTO public.labels (slug, name, description, category, is_preset, sending_identity_id)
SELECT
  v.slug, v.name, v.description, v.category, true, si.id
FROM (VALUES
  ('ffsa-family', 'FFSA Family', 'Contacts who have submitted a school or volunteer application.', 'General')
) AS v(slug, name, description, category)
CROSS JOIN (
  SELECT id FROM public.sending_identities WHERE slug = 'default-marketing' LIMIT 1
) AS si
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- Validation
-- ------------------------------------------------------------
--   SELECT slug, name, is_preset FROM public.labels WHERE slug = 'ffsa-family';
--   -- expect: ffsa-family | FFSA Family | true
-- ============================================================
