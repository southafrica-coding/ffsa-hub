-- ============================================================
-- FFSA Hub — Migration 140: configurable buyer detail fields
-- ============================================================
-- Lets an organizer control the standard "Your details" fields collected
-- once per order at checkout (first name, last name, email, phone,
-- marketing opt-in) — show/hide + required per field. This is separate
-- from, and additive to, the event-level checkout questions (094/migr
-- for custom per-order questions) and the per-tier per-ticket questions
-- (ticket_type_questions). Three independent layers of collection.
--
-- One column:
--   - events.buyer_fields : a JSON array of per-field config objects
--     shaped { key, enabled, required } where key is one of
--     first_name | last_name | email | phone | marketing_consent.
--     Empty array = built-in defaults (see src/lib/ticketing/buyer-fields.ts:
--     first/last/email required, phone shown+optional, opt-in shown).
--     Email is always enabled + required regardless of what's stored
--     (receipts + CRM dedup depend on it); the resolver enforces this.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS. Safe to re-run.
-- ============================================================

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS buyer_fields jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.events.buyer_fields IS
  'Per-event config for the standard checkout buyer fields. JSON array of { key, enabled, required } (key: first_name|last_name|email|phone|marketing_consent). Empty = built-in defaults. Email is always enabled+required (enforced in code).';

-- ============================================================
-- Validation
-- ------------------------------------------------------------
--   SELECT column_name, data_type, column_default
--   FROM information_schema.columns
--   WHERE table_name = 'events' AND column_name = 'buyer_fields';
--   -- expect 1 row, jsonb defaulting to '[]'
-- ============================================================
