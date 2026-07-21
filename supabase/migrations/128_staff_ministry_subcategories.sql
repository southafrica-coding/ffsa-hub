-- ============================================================
-- FFSA Hub — Migration 128: Staff ministry sub-categories
-- ============================================================
-- Sub-categories divide a single staff ministry's roster into named
-- sub-groups (e.g. within the "Training" ministry). Each ministry owns its
-- own list. A staff_ministry_members row optionally points at ONE sub-category
-- (subcategory_id NULL = "Uncategorized").
--
-- Scope (confirmed with the product owner):
--   * The sub-category LIST is admin-managed (is_admin() only) — create /
--     rename / delete. RLS below enforces this.
--   * ASSIGNING a member into a sub-category writes to staff_ministry_members,
--     which is already governed by the leads_staff_ministry() policy from
--     migration 126 — so admins AND ministry leaders can assign, matching who
--     manages the roster today.
--
-- Deleting a sub-category drops its members back to Uncategorized
-- (ON DELETE SET NULL) rather than removing the memberships.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Table
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.staff_ministry_subcategories (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_ministry_id  uuid NOT NULL REFERENCES public.staff_ministries (id) ON DELETE CASCADE,
  name               text NOT NULL,
  sort_order         int NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (staff_ministry_id, name)
);

CREATE INDEX IF NOT EXISTS idx_staff_ministry_subcategories_ministry
  ON public.staff_ministry_subcategories (staff_ministry_id, sort_order);

-- ────────────────────────────────────────────────────────────
-- 2. Membership → sub-category link (nullable; NULL = Uncategorized).
--    ON DELETE SET NULL keeps the person in the ministry when their
--    sub-category is removed.
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.staff_ministry_members
  ADD COLUMN IF NOT EXISTS subcategory_id uuid
    REFERENCES public.staff_ministry_subcategories (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_staff_ministry_members_subcategory
  ON public.staff_ministry_members (subcategory_id);

-- ────────────────────────────────────────────────────────────
-- 3. RLS — readable to any authenticated user (so leaders can render the
--    groups); only admins write the list. Mirrors the 126 policies.
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.staff_ministry_subcategories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff ministry sub-categories are readable" ON public.staff_ministry_subcategories;
CREATE POLICY "Staff ministry sub-categories are readable"
  ON public.staff_ministry_subcategories FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Admins manage staff ministry sub-categories" ON public.staff_ministry_subcategories;
CREATE POLICY "Admins manage staff ministry sub-categories"
  ON public.staff_ministry_subcategories FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ============================================================
-- Validation
-- ------------------------------------------------------------
--   -- create a sub-category under the Training ministry:
--   INSERT INTO public.staff_ministry_subcategories (staff_ministry_id, name)
--   SELECT id, 'Example' FROM public.staff_ministries WHERE slug = 'training';
--
--   SELECT c.name, c.sort_order
--     FROM public.staff_ministry_subcategories c
--     JOIN public.staff_ministries m ON m.id = c.staff_ministry_id
--    WHERE m.slug = 'training' ORDER BY c.sort_order, c.name;
--
--   -- column present + FK behaviour:
--   SELECT count(*) FROM public.staff_ministry_members WHERE subcategory_id IS NOT NULL;
-- ============================================================
