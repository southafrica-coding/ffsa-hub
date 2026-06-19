-- ============================================================
-- FFSA Hub — School Billing Engine (itemized + scheduled)
-- ============================================================
-- Run AFTER 093_seed_ffsa_camps_identity.sql
-- (094 is reserved by the checkout-questions branch.)
--
-- Adds a configurable, per-course/tier billing model on top of
-- the existing School Fees module WITHOUT touching the live
-- student_fees / student_payments tables or their 2026 data.
--
-- Hierarchy (per Training lead):
--   program_groups  = "Program"  (e.g. FFX 2027 — the year-long big picture)
--   programs (rows) = "Courses"  (FFXYL / FFXQ / FFBXQ / FFWVQ)
--                     ^ existing table; enrollments + student_fees key off it
--
-- New tables:
--   1. program_groups          — the "Program" umbrella
--   2. fee_charge_items        — per course+tier charge config (Deposit,
--                                Monthly Tuition, Outreach, Quarter 1st/Final)
--   3. student_billing_plans   — one per enrollment; holds payment preference
--   4. student_billing_schedule — the expanded schedule of charges/invoices
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. PROGRAM GROUPS — the "Program" umbrella over courses
-- ────────────────────────────────────────────────────────────

CREATE TABLE public.program_groups (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,                        -- "FFX Year Long"
  code          text UNIQUE NOT NULL,                 -- "FFX2027"
  year          integer,                              -- 2027
  description   text,
  status        text NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'archived')),
  created_by    uuid REFERENCES public.users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.program_groups
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Link existing programs (= "courses") to their program group.
-- Nullable so existing programs are unaffected until explicitly grouped.
ALTER TABLE public.programs
  ADD COLUMN IF NOT EXISTS program_group_id uuid
    REFERENCES public.program_groups(id) ON DELETE SET NULL;

-- Per-course billing anchors (used by quarter "relative to arrival" rules).
-- Nullable; only quarter courses need an arrival date.
ALTER TABLE public.programs
  ADD COLUMN IF NOT EXISTS billing_arrival_date date;
ALTER TABLE public.programs
  ADD COLUMN IF NOT EXISTS billing_start_date date;

CREATE INDEX idx_programs_group ON public.programs(program_group_id);

-- ────────────────────────────────────────────────────────────
-- 2. FEE CHARGE ITEMS — configurable charges per course + tier
-- ────────────────────────────────────────────────────────────
-- Each row is a *template* for one chargeable item. The schedule
-- builder (checkpoint 2) expands these into student_billing_schedule
-- rows. e.g. one Monthly Tuition row with quantity=10 → 10 schedule rows.

CREATE TABLE public.fee_charge_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id      uuid NOT NULL REFERENCES public.programs(id) ON DELETE CASCADE, -- the "course"
  tier            text NOT NULL CHECK (tier IN ('A', 'B', 'C')),

  charge_type     text NOT NULL CHECK (charge_type IN (
                    'deposit',
                    'monthly_tuition',
                    'outreach',
                    'quarter_first',
                    'quarter_final'
                  )),
  label           text NOT NULL,                       -- "Monthly Tuition"
  amount_zar      numeric(12,2) NOT NULL DEFAULT 0,    -- per-occurrence amount
  xero_item_code  text,                                -- "FFXYL2027-MON-A"

  -- Recurrence
  cadence         text NOT NULL DEFAULT 'once'
                  CHECK (cadence IN ('once', 'monthly')),
  quantity        integer NOT NULL DEFAULT 1,          -- # of occurrences (e.g. 10)

  -- When each occurrence is DUE
  due_anchor      text NOT NULL DEFAULT 'month_day'
                  CHECK (due_anchor IN (
                    'acceptance',          -- due immediately on acceptance
                    'month_day',           -- due on `due_day` of a month
                    'fixed_date',          -- due on `fixed_due_date`
                    'relative_to_arrival'  -- due arrival + `arrival_offset_days`
                  )),
  due_day             integer,             -- day-of-month (e.g. 4)
  first_due_month     integer,             -- month of first occurrence (1-12)
  first_due_year      integer,             -- defaults to program_group.year if null
  fixed_due_date      date,                -- for due_anchor='fixed_date' (e.g. 2027-03-04)
  arrival_offset_days integer,             -- for relative_to_arrival (-30 first, 0 final)

  -- When each occurrence's invoice is GENERATED in Xero
  generation_rule text NOT NULL DEFAULT 'preceding_month_15th'
                  CHECK (generation_rule IN (
                    'immediate',             -- on acceptance (deposits)
                    'preceding_month_15th',  -- 15th of the month before due
                    'fixed_date',            -- on generation_fixed_date
                    'days_before_due'        -- due minus generation_lead_days
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

CREATE INDEX idx_fci_program ON public.fee_charge_items(program_id);
CREATE INDEX idx_fci_program_tier ON public.fee_charge_items(program_id, tier);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.fee_charge_items
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ────────────────────────────────────────────────────────────
-- 3. STUDENT BILLING PLANS — one per enrollment
-- ────────────────────────────────────────────────────────────
-- Holds the student's payment preference; the schedule rows hang off it.

CREATE TABLE public.student_billing_plans (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id      uuid NOT NULL UNIQUE REFERENCES public.enrollments(id) ON DELETE CASCADE,
  user_id            uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  program_id         uuid NOT NULL REFERENCES public.programs(id) ON DELETE CASCADE, -- the "course"
  program_group_id   uuid REFERENCES public.program_groups(id) ON DELETE SET NULL,
  tier               text NOT NULL CHECK (tier IN ('A', 'B', 'C')),
  tier_override      boolean NOT NULL DEFAULT false,

  payment_preference text NOT NULL DEFAULT 'standard'
                     CHECK (payment_preference IN (
                       'standard',       -- monthly schedule
                       'quarter_prepay', -- combine each quarter into one invoice
                       'full_prepay'     -- one combined invoice for everything
                     )),

  xero_region        text NOT NULL DEFAULT 'za' CHECK (xero_region IN ('za', 'us')),
  status             text NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'completed', 'withdrawn', 'cancelled')),
  notes              text,
  created_by         uuid REFERENCES public.users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sbp_user ON public.student_billing_plans(user_id);
CREATE INDEX idx_sbp_program ON public.student_billing_plans(program_id);
CREATE INDEX idx_sbp_enrollment ON public.student_billing_plans(enrollment_id);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.student_billing_plans
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ────────────────────────────────────────────────────────────
-- 4. STUDENT BILLING SCHEDULE — expanded charges / invoices
-- ────────────────────────────────────────────────────────────
-- The full schedule lives here. Invoices are only pushed to Xero
-- when scheduled_generation_date arrives (status: scheduled → generated → sent → paid).

CREATE TABLE public.student_billing_schedule (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id                  uuid NOT NULL REFERENCES public.student_billing_plans(id) ON DELETE CASCADE,
  charge_item_id           uuid REFERENCES public.fee_charge_items(id) ON DELETE SET NULL,

  charge_type              text NOT NULL,
  label                    text NOT NULL,              -- "March Tuition", "Deposit"
  sequence                 integer NOT NULL DEFAULT 1, -- 1..N for monthly occurrences
  amount_zar               numeric(12,2) NOT NULL DEFAULT 0,
  xero_item_code           text,

  scheduled_generation_date date NOT NULL,             -- when Hub should create the invoice
  due_date                  date NOT NULL,

  status                   text NOT NULL DEFAULT 'scheduled'
                           CHECK (status IN (
                             'scheduled',  -- planned, not yet in Xero
                             'generated',  -- DRAFT/AUTHORISED invoice exists in Xero
                             'sent',        -- emailed to student
                             'paid',
                             'cancelled'
                           )),

  -- Xero linkage (one invoice per schedule row, or shared when combined)
  xero_invoice_id          text,
  xero_invoice_number      text,
  xero_invoice_url         text,
  combined_group_key       text,           -- rows sharing this key are one combined invoice

  amount_paid_zar          numeric(12,2) NOT NULL DEFAULT 0,
  generated_at             timestamptz,
  sent_at                  timestamptz,
  paid_at                  timestamptz,
  notes                    text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sbs_plan ON public.student_billing_schedule(plan_id);
CREATE INDEX idx_sbs_status ON public.student_billing_schedule(status);
CREATE INDEX idx_sbs_gen_date ON public.student_billing_schedule(scheduled_generation_date);
CREATE INDEX idx_sbs_due_date ON public.student_billing_schedule(due_date);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.student_billing_schedule
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ────────────────────────────────────────────────────────────
-- 5. ROW LEVEL SECURITY
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.program_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fee_charge_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_billing_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_billing_schedule ENABLE ROW LEVEL SECURITY;

-- Program Groups (reference/config — authenticated read, finance write)
CREATE POLICY "Authenticated can read program groups"
  ON public.program_groups FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Finance can insert program groups"
  ON public.program_groups FOR INSERT
  WITH CHECK (public.is_admin() OR public.has_role('finance_admin'));

CREATE POLICY "Finance can update program groups"
  ON public.program_groups FOR UPDATE
  USING (public.is_admin() OR public.has_role('finance_admin'))
  WITH CHECK (public.is_admin() OR public.has_role('finance_admin'));

CREATE POLICY "Finance can delete program groups"
  ON public.program_groups FOR DELETE
  USING (public.is_admin() OR public.has_role('finance_admin'));

-- Fee Charge Items (config — authenticated read, finance write)
CREATE POLICY "Authenticated can read charge items"
  ON public.fee_charge_items FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Finance can insert charge items"
  ON public.fee_charge_items FOR INSERT
  WITH CHECK (public.is_admin() OR public.has_role('finance_admin'));

CREATE POLICY "Finance can update charge items"
  ON public.fee_charge_items FOR UPDATE
  USING (public.is_admin() OR public.has_role('finance_admin'))
  WITH CHECK (public.is_admin() OR public.has_role('finance_admin'));

CREATE POLICY "Finance can delete charge items"
  ON public.fee_charge_items FOR DELETE
  USING (public.is_admin() OR public.has_role('finance_admin'));

-- Student Billing Plans (finance read all, students read own)
CREATE POLICY "Finance can read all billing plans"
  ON public.student_billing_plans FOR SELECT
  USING (public.is_admin() OR public.has_role('finance_admin'));

CREATE POLICY "Students can read own billing plans"
  ON public.student_billing_plans FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Finance can insert billing plans"
  ON public.student_billing_plans FOR INSERT
  WITH CHECK (public.is_admin() OR public.has_role('finance_admin'));

CREATE POLICY "Finance can update billing plans"
  ON public.student_billing_plans FOR UPDATE
  USING (public.is_admin() OR public.has_role('finance_admin'))
  WITH CHECK (public.is_admin() OR public.has_role('finance_admin'));

CREATE POLICY "Finance can delete billing plans"
  ON public.student_billing_plans FOR DELETE
  USING (public.is_admin());

-- Student Billing Schedule (finance read all, students read own via plan)
CREATE POLICY "Finance can read all schedule rows"
  ON public.student_billing_schedule FOR SELECT
  USING (public.is_admin() OR public.has_role('finance_admin'));

CREATE POLICY "Students can read own schedule rows"
  ON public.student_billing_schedule FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.student_billing_plans p
      WHERE p.id = plan_id AND p.user_id = auth.uid()
    )
  );

CREATE POLICY "Finance can insert schedule rows"
  ON public.student_billing_schedule FOR INSERT
  WITH CHECK (public.is_admin() OR public.has_role('finance_admin'));

CREATE POLICY "Finance can update schedule rows"
  ON public.student_billing_schedule FOR UPDATE
  USING (public.is_admin() OR public.has_role('finance_admin'))
  WITH CHECK (public.is_admin() OR public.has_role('finance_admin'));

CREATE POLICY "Finance can delete schedule rows"
  ON public.student_billing_schedule FOR DELETE
  USING (public.is_admin() OR public.has_role('finance_admin'));
