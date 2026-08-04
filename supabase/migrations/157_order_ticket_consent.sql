-- ============================================================
-- FFSA Hub — Migration 157: ticket-purchase consent on orders
-- ============================================================
-- Records that the buyer accepted the Ticket Purchase Terms &
-- Consent Agreement at checkout, and which version they accepted.
--
-- Ticket buyers are anonymous (no user account), so the order row is
-- the natural, self-contained acceptance record — it already snapshots
-- the buyer's identity, contact details, marketing opt-in and answers.
-- This mirrors that pattern rather than reusing the account-scoped
-- consent_agreements / consent_records tables (migration 034), which
-- are a single-current POPIA privacy doc keyed to users/applicants.
--
-- The agreement text itself is a versioned constant in code
-- (src/lib/ticketing/consent-terms.ts) rendered at /legal/ticket-terms;
-- only the accepted version + timestamp are persisted here for audit.
--
-- Two columns:
--   - orders.consent_version     : the version string the buyer accepted
--     (e.g. "tickets-v1.0-2026-08-04"). NULL for legacy orders created
--     before this feature.
--   - orders.consent_accepted_at : when acceptance was recorded (server
--     time at checkout). NULL for legacy orders.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS. Safe to re-run.
-- ============================================================

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS consent_version text,
  ADD COLUMN IF NOT EXISTS consent_accepted_at timestamptz;

COMMENT ON COLUMN public.orders.consent_version IS
  'Version of the Ticket Purchase Terms & Consent Agreement the buyer accepted at checkout (see src/lib/ticketing/consent-terms.ts). NULL for orders predating migration 157.';
COMMENT ON COLUMN public.orders.consent_accepted_at IS
  'Server timestamp when the buyer accepted the ticket consent agreement at checkout. NULL for orders predating migration 157.';

-- ============================================================
-- Validation
-- ------------------------------------------------------------
--   SELECT column_name, data_type
--   FROM information_schema.columns
--   WHERE table_name = 'orders'
--     AND column_name IN ('consent_version', 'consent_accepted_at');
--   -- expect 2 rows (text, timestamptz)
-- ============================================================
