-- ============================================================
-- Queue a NEXT (pending) health-insurance policy
-- ============================================================
-- A member can line up a successor policy while their current one is still
-- active. It's held here, separate from the live policy, until the current
-- policy lapses — then the daily /api/cron/promote-policies job copies these
-- values into the health_insurance_* columns (which snapshots history via the
-- existing trigger) and clears them again.
--
-- These are intentionally NOT the columns the insurance-history trigger watches
-- (health_insurance_provider/policy_number/expiry_date), so queuing a successor
-- never touches "Policies on record" until it actually becomes current.
--
-- All nullable: NULL/empty means "no successor queued". No new RLS needed — a
-- member already reads/writes their own users row, and admins read all.
-- ============================================================

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS next_health_insurance_provider text,
  ADD COLUMN IF NOT EXISTS next_health_insurance_policy_number text,
  ADD COLUMN IF NOT EXISTS next_health_insurance_expiry_date date;
