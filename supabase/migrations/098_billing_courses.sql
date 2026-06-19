-- ============================================================
-- FFSA Hub — Billing re-architecture: Program → Course
-- ============================================================
-- Run AFTER 097_seed_country_tiers.sql
--
-- Corrects the billing hierarchy: a Program (existing `programs` row,
-- e.g. "FFSA Gap year 2027") contains chronological, time-boxed
-- COURSES (FFXYL, FFXQ, FFBXQ, FFWVQ). Charge items, billing plans
-- and schedules now hang off a COURSE, not the Program.
--
--   programs (umbrella)  →  billing_courses  →  fee_charge_items
--                                            →  student_billing_plans → schedule
--
-- The dedicated billing_courses table is kept SEPARATE from the
-- academic `courses` table (which is grade-oriented).
--
-- NOTE: this clears the (new, still-being-configured) billing config
-- tables created in 095 and re-keys them to course_id. Any charge items
-- entered under the old program-level setup must be re-entered per course.
-- The dormant program_groups table from 095 is retired here.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. BILLING COURSES — chronological courses under a Program
-- ────────────────────────────────────────────────────────────

CREATE TABLE public.billing_courses (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id       uuid NOT NULL REFERENCES public.programs(id) ON DELETE CASCADE,
  code             text NOT NULL,                  -- FFXYL, FFXQ, FFBXQ, FFWVQ
  name             text NOT NULL,                  -- "FFX Year Long", "FFX Quarter 1"
  scope            text NOT NULL DEFAULT 'segment'
                   CHECK (scope IN ('full_program', 'segment')),
  sequence         integer NOT NULL DEFAULT 0,     -- chronological order within the program
  start_date       date,
  end_date         date,
  arrival_date     date,                            -- anchor for relative_to_arrival charges
  enroll_lead_days integer NOT NULL DEFAULT 30,     -- enrolment opens N days before start_date
  status           text NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'archived')),
  notes            text,
  created_by       uuid REFERENCES public.users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (program_id, code)
);

CREATE INDEX idx_billing_courses_program ON public.billing_courses(program_id);
CREATE INDEX idx_billing_courses_sequence ON public.billing_courses(program_id, sequence);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.billing_courses
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ────────────────────────────────────────────────────────────
-- 2. RE-KEY fee_charge_items: program_id → course_id
-- ────────────────────────────────────────────────────────────

TRUNCATE public.fee_charge_items CASCADE;  -- cascades to student_billing_schedule (FK on charge_item_id)

ALTER TABLE public.fee_charge_items
  DROP CONSTRAINT IF EXISTS fee_charge_items_program_id_tier_charge_type_key;
ALTER TABLE public.fee_charge_items DROP COLUMN IF EXISTS program_id;
ALTER TABLE public.fee_charge_items
  ADD COLUMN course_id uuid NOT NULL REFERENCES public.billing_courses(id) ON DELETE CASCADE;
ALTER TABLE public.fee_charge_items
  ADD CONSTRAINT fee_charge_items_course_tier_type_key UNIQUE (course_id, tier, charge_type);
CREATE INDEX idx_fci_course ON public.fee_charge_items(course_id);
CREATE INDEX idx_fci_course_tier ON public.fee_charge_items(course_id, tier);

-- ────────────────────────────────────────────────────────────
-- 3. RE-KEY student_billing_plans: add course_id, allow one plan
--    per (enrollment, course) so whole-year students can hold many
-- ────────────────────────────────────────────────────────────

TRUNCATE public.student_billing_plans CASCADE;  -- cascades to student_billing_schedule

ALTER TABLE public.student_billing_plans
  DROP CONSTRAINT IF EXISTS student_billing_plans_enrollment_id_key;
ALTER TABLE public.student_billing_plans DROP COLUMN IF EXISTS program_group_id;
ALTER TABLE public.student_billing_plans
  ADD COLUMN course_id uuid NOT NULL REFERENCES public.billing_courses(id) ON DELETE CASCADE;
ALTER TABLE public.student_billing_plans
  ADD CONSTRAINT sbp_enrollment_course_key UNIQUE (enrollment_id, course_id);
CREATE INDEX idx_sbp_course ON public.student_billing_plans(course_id);

-- ────────────────────────────────────────────────────────────
-- 4. RETIRE program_groups (the existing `programs` table is the umbrella)
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.programs DROP COLUMN IF EXISTS program_group_id;
ALTER TABLE public.programs DROP COLUMN IF EXISTS billing_arrival_date;
ALTER TABLE public.programs DROP COLUMN IF EXISTS billing_start_date;
DROP TABLE IF EXISTS public.program_groups CASCADE;

-- ────────────────────────────────────────────────────────────
-- 5. ROW LEVEL SECURITY — billing_courses
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.billing_courses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read billing courses"
  ON public.billing_courses FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Finance can insert billing courses"
  ON public.billing_courses FOR INSERT
  WITH CHECK (public.is_admin() OR public.has_role('finance_admin'));

CREATE POLICY "Finance can update billing courses"
  ON public.billing_courses FOR UPDATE
  USING (public.is_admin() OR public.has_role('finance_admin'))
  WITH CHECK (public.is_admin() OR public.has_role('finance_admin'));

CREATE POLICY "Finance can delete billing courses"
  ON public.billing_courses FOR DELETE
  USING (public.is_admin() OR public.has_role('finance_admin'));
