-- ============================================================
-- FFSA Hub — Billing courses: detail fields (Phase 2)
-- ============================================================
-- Adds course-detail attributes to billing_courses: a description,
-- a course leader, and a richer lifecycle status.
-- ============================================================

ALTER TABLE public.billing_courses
  ADD COLUMN IF NOT EXISTS description text;

ALTER TABLE public.billing_courses
  ADD COLUMN IF NOT EXISTS lead_staff_id uuid REFERENCES public.users(id) ON DELETE SET NULL;

-- Expand the lifecycle status (was active/archived).
ALTER TABLE public.billing_courses
  DROP CONSTRAINT IF EXISTS billing_courses_status_check;
ALTER TABLE public.billing_courses
  ADD CONSTRAINT billing_courses_status_check
  CHECK (status IN ('upcoming', 'active', 'completed', 'archived'));
