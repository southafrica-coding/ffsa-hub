-- ============================================================
-- FFSA Hub — Program-level (whole-program) pricing
-- ============================================================
-- Whole-program pricing becomes a first-class PROGRAM-level concept
-- (not a course with scope='full_program'). Courses are now simply
-- courses. A student is billed EITHER the whole-program structure
-- (program_charge_items) OR specific courses' charges.
-- ============================================================

-- 1. Program-level charge items (the whole-program structure)
CREATE TABLE public.program_charge_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id      uuid NOT NULL REFERENCES public.programs(id) ON DELETE CASCADE,
  tier            text NOT NULL CHECK (tier IN ('A', 'B', 'C')),
  charge_type     text NOT NULL CHECK (charge_type IN (
                    'deposit', 'monthly_tuition', 'outreach',
                    'quarter_first', 'quarter_final'
                  )),
  label           text NOT NULL,
  amount_zar      numeric(12,2) NOT NULL DEFAULT 0,
  xero_item_code  text,
  cadence         text NOT NULL DEFAULT 'once' CHECK (cadence IN ('once', 'monthly')),
  quantity        integer NOT NULL DEFAULT 1,
  due_anchor      text NOT NULL DEFAULT 'month_day' CHECK (due_anchor IN (
                    'acceptance', 'month_day', 'fixed_date', 'relative_to_arrival'
                  )),
  due_day             integer,
  first_due_month     integer,
  first_due_year      integer,
  fixed_due_date      date,
  arrival_offset_days integer,
  generation_rule text NOT NULL DEFAULT 'preceding_month_15th' CHECK (generation_rule IN (
                    'immediate', 'preceding_month_15th', 'fixed_date', 'days_before_due'
                  )),
  generation_fixed_date date,
  generation_lead_days   integer,
  sort_order      integer NOT NULL DEFAULT 0,
  active          boolean NOT NULL DEFAULT true,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (program_id, tier, charge_type)
);

CREATE INDEX idx_pci_program ON public.program_charge_items(program_id);
CREATE INDEX idx_pci_program_tier ON public.program_charge_items(program_id, tier);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.program_charge_items
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 2. Allow a program-level (whole-program) billing plan: course_id NULL.
ALTER TABLE public.student_billing_plans ALTER COLUMN course_id DROP NOT NULL;
-- Exactly one whole-program plan per enrolment (course_id IS NULL).
CREATE UNIQUE INDEX sbp_enrollment_whole_program
  ON public.student_billing_plans (enrollment_id)
  WHERE course_id IS NULL;

-- 3. RLS — program_charge_items
ALTER TABLE public.program_charge_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read program charge items"
  ON public.program_charge_items FOR SELECT
  USING (auth.uid() IS NOT NULL);
CREATE POLICY "Finance can insert program charge items"
  ON public.program_charge_items FOR INSERT
  WITH CHECK (public.is_admin() OR public.has_role('finance_admin'));
CREATE POLICY "Finance can update program charge items"
  ON public.program_charge_items FOR UPDATE
  USING (public.is_admin() OR public.has_role('finance_admin'))
  WITH CHECK (public.is_admin() OR public.has_role('finance_admin'));
CREATE POLICY "Finance can delete program charge items"
  ON public.program_charge_items FOR DELETE
  USING (public.is_admin() OR public.has_role('finance_admin'));
