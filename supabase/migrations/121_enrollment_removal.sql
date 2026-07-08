-- ============================================================
-- FFSA Hub — Enrollment Removal (reversible remove + guarded delete)
-- ============================================================
-- Lets Training admins take a student off a school roster when the
-- student was accepted but isn't coming.
--
--   1. "Remove from school"  — reversible soft-remove. The enrollment
--      keeps its status, grades and fees so a Restore is lossless.
--   2. "Delete permanently"  — hard-deletes the enrollment row (grades,
--      student_fees and student_billing_plans cascade). Only permitted
--      on an already-removed enrollment (enforced in the API) so the
--      remove step always acts as a buffer. The student's Hub account
--      is untouched — this only unlinks them from the school.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Soft-remove columns
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.enrollments
  ADD COLUMN IF NOT EXISTS removed_at timestamptz,
  ADD COLUMN IF NOT EXISTS removed_by uuid REFERENCES public.users(id);

-- Fast lookup of the default (active) roster per program.
CREATE INDEX IF NOT EXISTS idx_enrollments_active
  ON public.enrollments (program_id)
  WHERE removed_at IS NULL;

-- ────────────────────────────────────────────────────────────
-- 2. DELETE policy — same authority as updating an enrollment
--    (mirrors the FOR UPDATE policy from migration 020).
--    The remove-first guard lives in the API layer.
-- ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Schools managers can delete enrollments" ON public.enrollments;

CREATE POLICY "Schools managers can delete enrollments"
  ON public.enrollments FOR DELETE
  USING (public.has_schools_access() OR public.has_permission('schools.manage_enrollments'));
