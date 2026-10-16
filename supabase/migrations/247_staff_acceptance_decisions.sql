-- ────────────────────────────────────────────────────────────
-- 247 — Leadership Track: "accepted as staff?" decisions
--
-- At the end of Leadership Track the Leadership Team decides, per student,
-- whether they are accepted onto staff. One row per enrolment holds the
-- latest decision:
--
--   accepted = true  → note optional
--   accepted = false → note REQUIRED (enforced by CHECK, not just the UI)
--
-- Visible to the Leadership Team only — not admins, not program leaders,
-- not the student. Deliberately NOT routed through application_gate()
-- (migration 223): this access never expires after the school ends.
--
-- The app writes through the service role after an isLeadershipTeam()
-- check; the policies below are the backstop.
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.staff_acceptance_decisions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id  uuid NOT NULL UNIQUE REFERENCES public.enrollments(id) ON DELETE CASCADE,
  program_id     uuid NOT NULL REFERENCES public.programs(id) ON DELETE CASCADE,
  -- Nullable like enrollments.user_id (migration 207): the decision outlives
  -- a deleted login.
  user_id        uuid REFERENCES public.users(id) ON DELETE SET NULL,
  accepted       boolean NOT NULL,
  note           text,
  decided_by     uuid REFERENCES public.users(id) ON DELETE SET NULL,
  decided_at     timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_acceptance_no_needs_note
    CHECK (accepted OR length(btrim(coalesce(note, ''))) > 0)
);

CREATE INDEX IF NOT EXISTS idx_sad_program ON public.staff_acceptance_decisions(program_id);

DROP TRIGGER IF EXISTS set_updated_at ON public.staff_acceptance_decisions;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.staff_acceptance_decisions
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.staff_acceptance_decisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Leadership Team reads staff decisions" ON public.staff_acceptance_decisions;
CREATE POLICY "Leadership Team reads staff decisions"
  ON public.staff_acceptance_decisions FOR SELECT
  USING (public.has_role('leadership_team'));

DROP POLICY IF EXISTS "Leadership Team adds staff decisions" ON public.staff_acceptance_decisions;
CREATE POLICY "Leadership Team adds staff decisions"
  ON public.staff_acceptance_decisions FOR INSERT
  WITH CHECK (public.has_role('leadership_team'));

DROP POLICY IF EXISTS "Leadership Team updates staff decisions" ON public.staff_acceptance_decisions;
CREATE POLICY "Leadership Team updates staff decisions"
  ON public.staff_acceptance_decisions FOR UPDATE
  USING (public.has_role('leadership_team'))
  WITH CHECK (public.has_role('leadership_team'));

DROP POLICY IF EXISTS "Leadership Team removes staff decisions" ON public.staff_acceptance_decisions;
CREATE POLICY "Leadership Team removes staff decisions"
  ON public.staff_acceptance_decisions FOR DELETE
  USING (public.has_role('leadership_team'));

-- ============================================================
-- Validation
-- ------------------------------------------------------------
--   SELECT relrowsecurity FROM pg_class
--    WHERE oid = 'public.staff_acceptance_decisions'::regclass;   -- true
--
--   SELECT polname FROM pg_policy
--    WHERE polrelid = 'public.staff_acceptance_decisions'::regclass;  -- 4 rows
--
--   -- A "No" without a note must be rejected:
--   BEGIN;
--   INSERT INTO public.staff_acceptance_decisions (enrollment_id, program_id, accepted, note)
--   SELECT e.id, e.program_id, false, '  ' FROM public.enrollments e LIMIT 1;
--   -- ERROR: violates check constraint "staff_acceptance_no_needs_note"
--   ROLLBACK;
--
-- ROLLBACK (undo this migration)
-- ------------------------------------------------------------
--   DROP TABLE IF EXISTS public.staff_acceptance_decisions;
-- ============================================================
