-- ============================================================
-- FFSA Hub — Migration 235: Xero "Schools" tracking option on charges
-- ============================================================
-- Both Xero organisations carry a "Schools" tracking category, and finance
-- reports split income by it. The option belongs to the CHARGE, not the
-- school: a Gap Year 2027 student's whole-year deposit is "Gap Year 2027",
-- while a standalone FFBX quarter is "FFBX 2027" (FFSA's US item-code sheet).
--
-- The option NAME is stored, not a Xero id: the SA and US organisations have
-- separate ids for the same option, and the invoice run resolves the name in
-- whichever organisation the student is billed in. A name that organisation
-- doesn't have leaves that line untagged and is reported — never a failure.
--
-- Copied onto each schedule row when it is built, exactly like
-- xero_item_code, so a later edit to a charge doesn't silently re-tag
-- charges already scheduled.
-- ============================================================

ALTER TABLE public.program_charge_items
  ADD COLUMN IF NOT EXISTS xero_tracking_option text;

ALTER TABLE public.fee_charge_items
  ADD COLUMN IF NOT EXISTS xero_tracking_option text;

ALTER TABLE public.student_billing_schedule
  ADD COLUMN IF NOT EXISTS xero_tracking_option text;

COMMENT ON COLUMN public.program_charge_items.xero_tracking_option IS
  'Option name in the Xero "Schools" tracking category (e.g. Gap Year 2027). Resolved by name per organisation at invoice time.';
COMMENT ON COLUMN public.fee_charge_items.xero_tracking_option IS
  'Option name in the Xero "Schools" tracking category (e.g. FFBX 2027). Resolved by name per organisation at invoice time.';
COMMENT ON COLUMN public.student_billing_schedule.xero_tracking_option IS
  'Copied from the charge when the schedule is built. The invoice run tags the line with it.';

-- ------------------------------------------------------------
-- ROLLBACK:
--   ALTER TABLE public.program_charge_items DROP COLUMN IF EXISTS xero_tracking_option;
--   ALTER TABLE public.fee_charge_items DROP COLUMN IF EXISTS xero_tracking_option;
--   ALTER TABLE public.student_billing_schedule DROP COLUMN IF EXISTS xero_tracking_option;
-- ------------------------------------------------------------
