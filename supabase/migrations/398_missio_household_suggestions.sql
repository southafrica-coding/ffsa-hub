-- ============================================================
-- FFSA Hub — Migration 398: Missio household (couple) suggestions
-- ============================================================
-- DRAFT — DO NOT APPLY until Jack has reviewed the PR "Missio People —
-- couple suggestions". Nothing in the Hub needs it: without the table the
-- suggestion list is empty and the profile shows no banner.
--
-- APPLY ORDER: after 341 (missio_households) and 329 (organisations,
-- contacts in Missio, has_org_role_id). Nothing else depends on it.
--
-- The house church sheet lists 28 couples in one cell ("Gideon &
-- Riley"). The house-church import split them into two people but kept no
-- household. A gated script (scripts/missio-suggest-households.ts) files
-- each matched pair here as a PENDING suggestion. A pastor then links the
-- pair as a household (through the existing household helpers) or says
-- they're not a couple. Nothing here creates a household by itself, and
-- this table never holds children or labels: it is not a second family
-- graph.
--
--   missio_household_suggestions   one row per unordered pair of contacts
--                                  in an org. contact_a < contact_b, so
--                                  (A, B) and (B, A) are the same row.
--
-- Who: Missio pastors only (has_org_role_id(org_id, ['pastor'])), the same
-- wall as the other Missio pastor tables. Pastors read suggestions and move
-- a pending one to accepted or dismissed — nothing else. Only the service
-- role (the gated script) inserts. Leaders, coaches, FFSA admins and anon
-- get nothing. No seed rows: previews share the production database.
--
-- Only adds objects. Safe to re-run: IF NOT EXISTS / CREATE OR REPLACE,
-- triggers and policies dropped by name first.
-- ============================================================

BEGIN;

-- ────────────────────────────────────────────────────────────
-- 1. Table
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.missio_household_suggestions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL,
  contact_a    uuid NOT NULL,
  contact_b    uuid NOT NULL,
  source       text NOT NULL DEFAULT 'house_church_sheet' CHECK (source IN ('house_church_sheet')),
  -- The sheet line the couple was on, for the operator. Not shown to people.
  source_line  integer CHECK (source_line IS NULL OR source_line > 0),
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'dismissed')),
  reviewed_by  uuid,
  reviewed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT missio_household_suggestions_org_fkey
    FOREIGN KEY (org_id) REFERENCES public.organisations (id) ON DELETE RESTRICT,
  -- A suggestion about someone who is no longer a contact means nothing.
  CONSTRAINT missio_household_suggestions_contact_a_fkey
    FOREIGN KEY (contact_a) REFERENCES public.contacts (id) ON DELETE CASCADE,
  CONSTRAINT missio_household_suggestions_contact_b_fkey
    FOREIGN KEY (contact_b) REFERENCES public.contacts (id) ON DELETE CASCADE,
  CONSTRAINT missio_household_suggestions_reviewed_by_fkey
    FOREIGN KEY (reviewed_by) REFERENCES public.users (id) ON DELETE SET NULL,
  -- Canonical order: the unordered pair is stored once.
  CONSTRAINT missio_household_suggestions_pair_order CHECK (contact_a < contact_b),
  -- Pending has no review stamp; accepted / dismissed always has a time.
  CONSTRAINT missio_household_suggestions_review_shape CHECK (
    (status = 'pending' AND reviewed_by IS NULL AND reviewed_at IS NULL)
    OR (status <> 'pending' AND reviewed_at IS NOT NULL)
  )
);

-- One row per unordered pair in an org (the CHECK above makes (a, b) the
-- only order, so a plain unique index is the unordered-pair index).
CREATE UNIQUE INDEX IF NOT EXISTS missio_household_suggestions_pair_uidx
  ON public.missio_household_suggestions (org_id, contact_a, contact_b);
CREATE INDEX IF NOT EXISTS missio_household_suggestions_org_status_idx
  ON public.missio_household_suggestions (org_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS missio_household_suggestions_contact_b_idx
  ON public.missio_household_suggestions (contact_b);


-- ────────────────────────────────────────────────────────────
-- 2. Review stamp
-- ────────────────────────────────────────────────────────────
-- A pastor may only move a pending row to accepted or dismissed, and is
-- stamped as themselves whatever they send: reviewed_by can't name someone
-- else, and a reviewed row can't be reopened or swapped to the other
-- answer. The service role (no auth.uid()) passes its own values.
CREATE OR REPLACE FUNCTION public.missio_household_suggestion_stamp()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = '' AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN NEW;
  END IF;
  IF OLD.status <> 'pending' OR NEW.status NOT IN ('accepted', 'dismissed') THEN
    RAISE EXCEPTION 'missio_suggestion_already_reviewed' USING ERRCODE = '23514';
  END IF;
  NEW.reviewed_by := v_uid;
  NEW.reviewed_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.missio_household_suggestion_stamp() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS missio_household_suggestions_stamp ON public.missio_household_suggestions;
CREATE TRIGGER missio_household_suggestions_stamp
  BEFORE UPDATE ON public.missio_household_suggestions
  FOR EACH ROW EXECUTE FUNCTION public.missio_household_suggestion_stamp();


-- ────────────────────────────────────────────────────────────
-- 3. RLS — Missio pastors only; no anon
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.missio_household_suggestions ENABLE ROW LEVEL SECURITY;

-- No INSERT / DELETE / TRUNCATE / REFERENCES / TRIGGER for anyone but the
-- service role (default privileges), which the gated script uses.
REVOKE ALL ON TABLE public.missio_household_suggestions FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.missio_household_suggestions TO authenticated;
GRANT UPDATE (status, reviewed_by, reviewed_at) ON TABLE public.missio_household_suggestions TO authenticated;

DROP POLICY IF EXISTS "Missio pastors read household suggestions" ON public.missio_household_suggestions;
CREATE POLICY "Missio pastors read household suggestions"
  ON public.missio_household_suggestions FOR SELECT
  TO authenticated
  USING (public.has_org_role_id(org_id, ARRAY['pastor']));

DROP POLICY IF EXISTS "Missio pastors review household suggestions" ON public.missio_household_suggestions;
CREATE POLICY "Missio pastors review household suggestions"
  ON public.missio_household_suggestions FOR UPDATE
  TO authenticated
  USING (public.has_org_role_id(org_id, ARRAY['pastor']))
  WITH CHECK (public.has_org_role_id(org_id, ARRAY['pastor']));


-- ────────────────────────────────────────────────────────────
-- 4. Comments
-- ────────────────────────────────────────────────────────────
COMMENT ON TABLE public.missio_household_suggestions IS
  'Couples listed together on the house church sheet, for a pastor to confirm. One row per unordered pair (contact_a < contact_b). Never creates a household by itself; accepting goes through the household helpers. Service role inserts; pastors read and review.';
COMMENT ON FUNCTION public.missio_household_suggestion_stamp() IS
  'Pastors may only move pending to accepted or dismissed; stamps reviewed_by / reviewed_at as the signed-in pastor.';

COMMIT;


-- ============================================================
-- Verify:
--   SELECT column_name, data_type, is_nullable FROM information_schema.columns
--    WHERE table_name = 'missio_household_suggestions' ORDER BY ordinal_position;
--                     -- id, org_id, contact_a, contact_b, source, source_line,
--                     -- status, reviewed_by, reviewed_at, created_at
--   SELECT policyname, cmd FROM pg_policies
--    WHERE tablename = 'missio_household_suggestions' ORDER BY 2;
--                     -- SELECT, UPDATE (no INSERT / DELETE policy)
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--    WHERE table_name = 'missio_household_suggestions'
--      AND grantee IN ('PUBLIC', 'anon', 'authenticated') ORDER BY 1, 2;
--                     -- authenticated SELECT only (UPDATE is column-level)
--   SELECT column_name FROM information_schema.column_privileges
--    WHERE grantee = 'authenticated' AND privilege_type = 'UPDATE'
--      AND table_name = 'missio_household_suggestions' ORDER BY 1;
--                     -- reviewed_at, reviewed_by, status
--   SELECT prosecdef, proconfig FROM pg_proc WHERE proname = 'missio_household_suggestion_stamp';
--                     -- true, {search_path=""}
--   SELECT count(*) FROM public.missio_household_suggestions;   -- 0 (no seed)
--   Full role matrix: supabase/tests/missio_household_suggestions_rls.sql
--   (disposable database only).
-- ============================================================

-- ------------------------------------------------------------
-- ROLLBACK (deletes every suggestion; households already linked from an
-- accepted suggestion stay, because they live in missio_households):
--   DROP TABLE IF EXISTS public.missio_household_suggestions;
--   DROP FUNCTION IF EXISTS public.missio_household_suggestion_stamp();
-- ------------------------------------------------------------
