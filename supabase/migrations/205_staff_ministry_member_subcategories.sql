-- ============================================================
-- FFSA Hub — Migration 205: Multi-category ministry membership
-- ============================================================
-- Migration 128 gave a membership ONE sub-category
-- (staff_ministry_members.subcategory_id). The product owner wants a person to
-- be able to sit in SEVERAL categories of the same ministry at once — e.g.
-- someone in Training who serves in two of its categories.
--
-- This replaces the single FK column with a proper join table.
--
-- Decisions:
--   * The point-leader flag MOVES ONTO THE JOIN ROW. `is_category_point_leader`
--     was a per-member boolean, which is ambiguous the moment a member belongs
--     to several categories ("point leader of which one?"). It is now
--     per (membership, category).
--   * The old columns `subcategory_id` and `is_category_point_leader` are NOT
--     dropped here. The currently-live Vercel build still SELECTs them, and a
--     PostgREST select fails wholesale on a missing column, so dropping them
--     with this migration would break the live roster page in the window
--     between applying SQL and deploying the app. A follow-up migration drops
--     them once this deploy is confirmed green. Until then a small trigger
--     keeps `is_category_point_leader` in sync so derive-title.ts and the Users
--     pages keep working untouched.
--   * The "sub-category must belong to the SAME ministry as the membership"
--     rule stays enforced in the API (existing precedent in
--     src/app/api/ministries/[id]/members/route.ts), not in SQL — the two FKs
--     cannot express it.
--
-- NOTE: public.okr_objectives.subcategory_id (migration 182) is a DIFFERENT
-- column on a different table. It is deliberately untouched here.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Join table
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.staff_ministry_member_subcategories (
  membership_id   uuid NOT NULL REFERENCES public.staff_ministry_members (id) ON DELETE CASCADE,
  subcategory_id  uuid NOT NULL REFERENCES public.staff_ministry_subcategories (id) ON DELETE CASCADE,
  is_point_leader boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (membership_id, subcategory_id)
);

CREATE INDEX IF NOT EXISTS idx_smms_subcategory
  ON public.staff_ministry_member_subcategories (subcategory_id);

-- One point leader per sub-category (replaces one_point_leader_per_subcategory
-- from migration 129, which was anchored to the single-value column).
CREATE UNIQUE INDEX IF NOT EXISTS one_point_leader_per_subcategory_v2
  ON public.staff_ministry_member_subcategories (subcategory_id)
  WHERE is_point_leader;

-- ────────────────────────────────────────────────────────────
-- 2. Backfill from the single-value column
-- ────────────────────────────────────────────────────────────
INSERT INTO public.staff_ministry_member_subcategories
  (membership_id, subcategory_id, is_point_leader)
SELECT m.id, m.subcategory_id, m.is_category_point_leader
FROM public.staff_ministry_members m
WHERE m.subcategory_id IS NOT NULL
ON CONFLICT (membership_id, subcategory_id) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 3. Retire the single-value constraints (the columns themselves stay)
-- ────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS public.one_point_leader_per_subcategory;

ALTER TABLE public.staff_ministry_members
  DROP CONSTRAINT IF EXISTS category_point_leader_requires_subcategory;

COMMENT ON COLUMN public.staff_ministry_members.subcategory_id IS
  'DEPRECATED (migration 205): superseded by staff_ministry_member_subcategories. '
  'Retained for one deploy cycle so the previous app build keeps rendering; '
  'no longer written. Drop in a follow-up migration.';

COMMENT ON COLUMN public.staff_ministry_members.is_category_point_leader IS
  'DEPRECATED (migration 205): superseded by '
  'staff_ministry_member_subcategories.is_point_leader. Kept in sync by '
  'sync_legacy_category_point_leader() for derive-title.ts and the Users pages; '
  'drop together with subcategory_id.';

-- ────────────────────────────────────────────────────────────
-- 4. RLS — mirrors migration 128: readable to any authenticated user (so
--    leaders can render the groups); ministry leaders and admins may write,
--    via the leads_staff_ministry() helper from migration 126.
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.staff_ministry_member_subcategories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Member sub-categories are readable"
  ON public.staff_ministry_member_subcategories;
CREATE POLICY "Member sub-categories are readable"
  ON public.staff_ministry_member_subcategories FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Ministry leaders manage member sub-categories"
  ON public.staff_ministry_member_subcategories;
CREATE POLICY "Ministry leaders manage member sub-categories"
  ON public.staff_ministry_member_subcategories FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.staff_ministry_members m
       WHERE m.id = staff_ministry_member_subcategories.membership_id
         AND public.leads_staff_ministry(m.staff_ministry_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.staff_ministry_members m
       WHERE m.id = staff_ministry_member_subcategories.membership_id
         AND public.leads_staff_ministry(m.staff_ministry_id)
    )
  );

-- ────────────────────────────────────────────────────────────
-- 5. Compatibility trigger for the deprecated flag.
--    Keeps staff_ministry_members.is_category_point_leader true while ANY of
--    that membership's join rows is a point leader. Removed together with the
--    column in the follow-up migration.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_legacy_category_point_leader()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  mid uuid;
BEGIN
  mid := COALESCE(NEW.membership_id, OLD.membership_id);
  UPDATE public.staff_ministry_members m
     SET is_category_point_leader = EXISTS (
           SELECT 1 FROM public.staff_ministry_member_subcategories s
            WHERE s.membership_id = mid AND s.is_point_leader)
   WHERE m.id = mid;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_legacy_category_point_leader
  ON public.staff_ministry_member_subcategories;
CREATE TRIGGER trg_sync_legacy_category_point_leader
  AFTER INSERT OR UPDATE OR DELETE ON public.staff_ministry_member_subcategories
  FOR EACH ROW EXECUTE FUNCTION public.sync_legacy_category_point_leader();

-- ============================================================
-- Validation
-- ------------------------------------------------------------
--   -- Backfill parity (expect: true)
--   SELECT (SELECT count(*) FROM public.staff_ministry_members
--            WHERE subcategory_id IS NOT NULL)
--        = (SELECT count(*) FROM public.staff_ministry_member_subcategories)
--     AS matches;
--
--   -- Point leaders carried over (expect the same count both sides)
--   SELECT count(*) FROM public.staff_ministry_members WHERE is_category_point_leader;
--   SELECT count(*) FROM public.staff_ministry_member_subcategories WHERE is_point_leader;
--
--   -- A member in more than one category (nothing yet — proves it is allowed)
--   SELECT membership_id, count(*) FROM public.staff_ministry_member_subcategories
--    GROUP BY 1 HAVING count(*) > 1;
-- ============================================================
