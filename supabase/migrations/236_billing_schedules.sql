-- ============================================================
-- FFSA Hub — Migration 236: per-school payment schedule builder
-- ============================================================
-- Finance wants to design each school's payment schedule directly: a price per
-- tier, then an ordered list of payments (deposit, 2nd payment, final, a
-- monthly run ...) where each payment is a % of the price, a fixed rand amount
-- per tier, or "whatever's left".
--
-- billing_schedules holds that design, one per pricing target:
--   course_id IS NULL  → the school's whole-program pricing
--   course_id = X      → that course's standalone pricing
--
-- Saving a schedule COMPILES it into ordinary charge items (program_charge_items
-- / fee_charge_items), so the existing schedule builder, generation guard,
-- invoice run, billing switches and Xero tracking all keep working unchanged.
-- Compiled rows carry schedule_payment_key, which ties them back to the
-- payment that made them.
--
-- Two engine limits are lifted here:
--   1. UNIQUE (target, tier, charge_type) allowed one charge of each type per
--      tier, so "Deposit / 2nd payment / Final" could not coexist. The
--      uniqueness now applies only to hand-made rows (schedule_payment_key IS
--      NULL); builder rows are unique per (target, tier, payment key).
--   2. A charge could be due ON acceptance but not N days after it.
--      acceptance_offset_days adds that.
--
-- A new charge_type 'instalment' covers builder payments that are not a
-- monthly run.
-- ============================================================

-- ------------------------------------------------------------
-- 1. The schedule designs
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.billing_schedules (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id   uuid NOT NULL REFERENCES public.programs(id) ON DELETE CASCADE,
  course_id    uuid REFERENCES public.billing_courses(id) ON DELETE CASCADE,
  -- { "A": 120000, "B": 99500, "C": 80000 }
  tier_prices  jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Ordered payment definitions; shape lives in src/lib/finance/payment-schedule.ts
  payments     jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_by   uuid REFERENCES public.users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS billing_schedules_whole_program
  ON public.billing_schedules (program_id) WHERE course_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS billing_schedules_course
  ON public.billing_schedules (course_id) WHERE course_id IS NOT NULL;

DROP TRIGGER IF EXISTS set_updated_at ON public.billing_schedules;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.billing_schedules
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.billing_schedules ENABLE ROW LEVEL SECURITY;

-- Same shape as program_charge_items (101). Writes go through a finance-gated
-- API route using the service role, so these mainly guard direct access.
CREATE POLICY "Authenticated can read billing schedules"
  ON public.billing_schedules FOR SELECT
  USING (auth.uid() IS NOT NULL);
CREATE POLICY "Finance can insert billing schedules"
  ON public.billing_schedules FOR INSERT
  WITH CHECK (public.is_admin() OR public.has_role('finance_admin'));
CREATE POLICY "Finance can update billing schedules"
  ON public.billing_schedules FOR UPDATE
  USING (public.is_admin() OR public.has_role('finance_admin'))
  WITH CHECK (public.is_admin() OR public.has_role('finance_admin'));
CREATE POLICY "Finance can delete billing schedules"
  ON public.billing_schedules FOR DELETE
  USING (public.is_admin() OR public.has_role('finance_admin'));

-- ------------------------------------------------------------
-- 2. Charge items: builder linkage, 'instalment' type, acceptance offset
-- ------------------------------------------------------------
ALTER TABLE public.program_charge_items
  ADD COLUMN IF NOT EXISTS schedule_payment_key text,
  ADD COLUMN IF NOT EXISTS acceptance_offset_days integer;
ALTER TABLE public.fee_charge_items
  ADD COLUMN IF NOT EXISTS schedule_payment_key text,
  ADD COLUMN IF NOT EXISTS acceptance_offset_days integer;

ALTER TABLE public.program_charge_items
  DROP CONSTRAINT IF EXISTS program_charge_items_charge_type_check;
ALTER TABLE public.program_charge_items
  ADD CONSTRAINT program_charge_items_charge_type_check CHECK (charge_type IN (
    'deposit', 'monthly_tuition', 'outreach', 'quarter_first', 'quarter_final', 'instalment'
  ));

ALTER TABLE public.fee_charge_items
  DROP CONSTRAINT IF EXISTS fee_charge_items_charge_type_check;
ALTER TABLE public.fee_charge_items
  ADD CONSTRAINT fee_charge_items_charge_type_check CHECK (charge_type IN (
    'deposit', 'monthly_tuition', 'outreach', 'quarter_first', 'quarter_final', 'instalment'
  ));

-- One-per-type stays the rule for hand-made rows only.
ALTER TABLE public.program_charge_items
  DROP CONSTRAINT IF EXISTS program_charge_items_program_id_tier_charge_type_key;
CREATE UNIQUE INDEX IF NOT EXISTS pci_manual_one_per_type
  ON public.program_charge_items (program_id, tier, charge_type)
  WHERE schedule_payment_key IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS pci_schedule_payment
  ON public.program_charge_items (program_id, tier, schedule_payment_key)
  WHERE schedule_payment_key IS NOT NULL;

ALTER TABLE public.fee_charge_items
  DROP CONSTRAINT IF EXISTS fee_charge_items_course_tier_type_key;
CREATE UNIQUE INDEX IF NOT EXISTS fci_manual_one_per_type
  ON public.fee_charge_items (course_id, tier, charge_type)
  WHERE schedule_payment_key IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS fci_schedule_payment
  ON public.fee_charge_items (course_id, tier, schedule_payment_key)
  WHERE schedule_payment_key IS NOT NULL;

-- ============================================================
-- Validation
--   SELECT conname FROM pg_constraint
--    WHERE conrelid IN ('public.program_charge_items'::regclass, 'public.fee_charge_items'::regclass)
--      AND contype = 'u';
--   -- expect no rows: the per-type rule is now the partial indexes above
-- ============================================================

-- ------------------------------------------------------------
-- ROLLBACK (only safe while no two hand-made/builder rows share a type):
--   DROP TABLE IF EXISTS public.billing_schedules;
--   DROP INDEX IF EXISTS pci_manual_one_per_type, pci_schedule_payment,
--                        fci_manual_one_per_type, fci_schedule_payment;
--   DELETE FROM public.program_charge_items WHERE schedule_payment_key IS NOT NULL;
--   DELETE FROM public.fee_charge_items WHERE schedule_payment_key IS NOT NULL;
--   ALTER TABLE public.program_charge_items
--     ADD CONSTRAINT program_charge_items_program_id_tier_charge_type_key UNIQUE (program_id, tier, charge_type),
--     DROP COLUMN IF EXISTS schedule_payment_key, DROP COLUMN IF EXISTS acceptance_offset_days;
--   ALTER TABLE public.fee_charge_items
--     ADD CONSTRAINT fee_charge_items_course_tier_type_key UNIQUE (course_id, tier, charge_type),
--     DROP COLUMN IF EXISTS schedule_payment_key, DROP COLUMN IF EXISTS acceptance_offset_days;
--   (and restore the 5-value charge_type CHECKs)
-- ------------------------------------------------------------
