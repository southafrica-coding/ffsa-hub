-- ============================================================
-- Arrival-day health-insurance verification
-- ============================================================
-- On arrival day, staff physically check each student's health
-- insurance. This records THAT check (who did it, when) — distinct
-- from the auto-computed validity of the policy the student entered
-- on their profile (health_insurance_expiry_date on public.users).
--
-- Both columns are nullable: unset means "not yet checked on arrival".
-- No new RLS is needed — the existing program-scoped UPDATE policy on
-- public.enrollments ("Schools managers can update enrollments",
-- migration 040) already covers these columns and is not column-scoped.
-- ============================================================

ALTER TABLE public.enrollments
  ADD COLUMN IF NOT EXISTS insurance_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS insurance_verified_by uuid REFERENCES public.users(id);
