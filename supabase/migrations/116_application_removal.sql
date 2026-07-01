-- ============================================================
-- FFSA Hub — Application Removal (archive + guarded delete)
-- ============================================================
-- Adds a reversible "archive" for applications that are no
-- longer applicable, and a DELETE RLS policy so genuine test
-- rows can be permanently removed. Accepted applications are
-- never hard-deleted (guarded in the API) because they own an
-- enrollment / billing / user account — they are archived only.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Soft-archive columns
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.application_responses
  ADD COLUMN IF NOT EXISTS removed_at timestamptz,
  ADD COLUMN IF NOT EXISTS removed_by uuid REFERENCES public.users(id);

-- Fast lookup of the default (non-archived) list per program.
CREATE INDEX IF NOT EXISTS idx_app_responses_active
  ON public.application_responses (program_id)
  WHERE removed_at IS NULL;

-- ────────────────────────────────────────────────────────────
-- 2. DELETE policy — same authority as updating an application
--    (matches the FOR UPDATE policy added in migration 020).
--    Hard-delete of accepted applications is additionally
--    blocked in the API layer.
-- ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Schools managers can delete application responses" ON public.application_responses;

CREATE POLICY "Schools managers can delete application responses"
  ON public.application_responses FOR DELETE
  USING (public.has_schools_access() OR public.has_permission('schools.approve_applications'));
