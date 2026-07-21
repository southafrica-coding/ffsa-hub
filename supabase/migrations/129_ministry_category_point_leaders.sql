-- ============================================================
-- FFSA Hub — Migration 129: Per-category point leaders
-- ============================================================
-- Each staff-ministry sub-category can have its OWN point leader, in addition
-- to the single overall ministry point leader (staff_ministry_members.is_point_leader,
-- from migration 126 — kept as-is).
--
-- Membership stays single-category (staff_ministry_members.subcategory_id), so a
-- second boolean column is enough: is_category_point_leader marks the member as
-- the point leader OF the category their subcategory_id points at. A partial
-- unique index enforces one per category. The app only ever sets this for a
-- ministry LEADER who is in that category (enforced in the API route).
-- ============================================================

ALTER TABLE public.staff_ministry_members
  ADD COLUMN IF NOT EXISTS is_category_point_leader boolean NOT NULL DEFAULT false;

-- Exactly one category point leader per sub-category.
CREATE UNIQUE INDEX IF NOT EXISTS one_point_leader_per_subcategory
  ON public.staff_ministry_members (subcategory_id)
  WHERE is_category_point_leader;

-- The flag only makes sense when the member is actually in a category.
ALTER TABLE public.staff_ministry_members
  DROP CONSTRAINT IF EXISTS category_point_leader_requires_subcategory;
ALTER TABLE public.staff_ministry_members
  ADD CONSTRAINT category_point_leader_requires_subcategory
  CHECK (is_category_point_leader = false OR subcategory_id IS NOT NULL);

-- ============================================================
-- Validation
-- ------------------------------------------------------------
--   -- column present:
--   SELECT count(*) FROM public.staff_ministry_members WHERE is_category_point_leader;
--
--   -- the partial unique index blocks a 2nd point leader in the same category:
--   -- (attempting to set two members with the same subcategory_id to true errors 23505)
-- ============================================================
