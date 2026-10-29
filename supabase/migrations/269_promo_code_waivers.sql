-- ============================================================
-- FFSA Hub — Migration 269: promo codes that waive checkout steps
-- ============================================================
-- Extends the existing per-event promo codes (migration 057) so a code
-- can do more than take money off: it can also WAIVE process steps on
-- the tickets it applies to —
--   * the tier's signable waiver / consent form (migration 163), and
--   * any of the tier's per-ticket questions (migration 138), picked
--     individually by the admin when they configure the code.
--
-- Example: a "General" tier with a signed waiver plus three per-ticket
-- questions. Code STAFF26 is 100% off and waives the waiver and two of
-- the questions; code SPONSOR is 20% off and waives nothing. Whichever
-- code the buyer enters decides what that ticket still has to collect.
--
-- What a code waives follows its existing scope: a code restricted to
-- one tier (applies_to_ticket_type_id) waives steps on that tier's
-- tickets only; an any-tier code waives on every ticket in the order.
--
-- Columns:
--   promo_codes.kind              + 'none' — a code that only waives
--                                   steps and takes nothing off.
--   promo_codes.waives_waiver     skip the tier's signable waiver.
--   promo_codes.waived_questions  [{ ticket_type_id, question_id }] —
--                                   the per-ticket questions skipped.
--                                   Qualified by tier because question
--                                   ids are only unique within a tier.
--   orders.promo_code             snapshot of the code text as redeemed,
--                                   so exports stay readable if the code
--                                   is later renamed or deleted.
--   orders.waived_steps           [{ ticket_type_id, waiver, question_ids }]
--                                   what the code waived per tier, held on
--                                   the pending order until fulfilment.
--   tickets.promo_code_id         the code redeemed for this ticket.
--   tickets.waived_steps          { promo_code, waiver, question_ids } —
--                                   what was skipped for THIS ticket, so
--                                   the roster can say "waived" instead
--                                   of showing a blank as if missing.
--
-- RLS: no new tables. promo_codes, orders and tickets keep the policies
-- from 057 / 081 (staff read/manage; public checkout writes through the
-- service-role client), which cover the new columns.
--
-- Idempotent: safe to re-run.
-- ============================================================

-- ── promo_codes ─────────────────────────────────────────────

ALTER TABLE public.promo_codes
  DROP CONSTRAINT IF EXISTS promo_codes_kind_check;
ALTER TABLE public.promo_codes
  ADD CONSTRAINT promo_codes_kind_check
  CHECK (kind IN ('percent', 'fixed_amount', 'comp', 'none'));

ALTER TABLE public.promo_codes
  ADD COLUMN IF NOT EXISTS waives_waiver boolean NOT NULL DEFAULT false;

ALTER TABLE public.promo_codes
  ADD COLUMN IF NOT EXISTS waived_questions jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.promo_codes
  DROP CONSTRAINT IF EXISTS promo_codes_waived_questions_is_array;
ALTER TABLE public.promo_codes
  ADD CONSTRAINT promo_codes_waived_questions_is_array
  CHECK (jsonb_typeof(waived_questions) = 'array');

-- A 'none' code that waives nothing would be a code that does nothing.
ALTER TABLE public.promo_codes
  DROP CONSTRAINT IF EXISTS promo_codes_none_waives_something;
ALTER TABLE public.promo_codes
  ADD CONSTRAINT promo_codes_none_waives_something
  CHECK (
    kind <> 'none'
    OR waives_waiver
    OR jsonb_array_length(waived_questions) > 0
  );

COMMENT ON COLUMN public.promo_codes.kind IS
  'percent (percent_off) | fixed_amount (amount_off_cents, per order) | comp (100% off the in-scope tickets) | none (no discount — only waives steps).';
COMMENT ON COLUMN public.promo_codes.waives_waiver IS
  'When true, in-scope tickets skip their tier''s signable waiver (ticket_types.waiver) at checkout.';
COMMENT ON COLUMN public.promo_codes.waived_questions IS
  'Per-ticket questions this code skips: [{ ticket_type_id, question_id }] referencing ticket_types.questions[].id.';

-- ── orders ──────────────────────────────────────────────────

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS promo_code text;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS waived_steps jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.orders.promo_code IS
  'The promo code text as redeemed at checkout (snapshot alongside promo_code_id).';
COMMENT ON COLUMN public.orders.waived_steps IS
  'Steps the promo code waived, per tier: [{ ticket_type_id, waiver, question_ids }]. Drained onto tickets.waived_steps at fulfilment.';

-- ── tickets ─────────────────────────────────────────────────

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS promo_code_id uuid
  REFERENCES public.promo_codes(id) ON DELETE SET NULL;

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS waived_steps jsonb;

CREATE INDEX IF NOT EXISTS idx_tickets_promo_code
  ON public.tickets (promo_code_id) WHERE promo_code_id IS NOT NULL;

COMMENT ON COLUMN public.tickets.promo_code_id IS
  'Promo code redeemed for this ticket, if any.';
COMMENT ON COLUMN public.tickets.waived_steps IS
  'What a promo code waived for this ticket: { promo_code, waiver, question_ids }. NULL = nothing waived.';

-- ============================================================
-- Validation
-- ------------------------------------------------------------
--   SELECT table_name, column_name, data_type, column_default
--   FROM information_schema.columns
--   WHERE (table_name = 'promo_codes' AND column_name IN ('waives_waiver', 'waived_questions'))
--      OR (table_name = 'orders'      AND column_name IN ('promo_code', 'waived_steps'))
--      OR (table_name = 'tickets'     AND column_name IN ('promo_code_id', 'waived_steps'));
--   -- expect 6 rows
--
--   SELECT conname FROM pg_constraint
--   WHERE conrelid = 'public.promo_codes'::regclass AND contype = 'c';
--   -- includes promo_codes_kind_check, promo_codes_waived_questions_is_array,
--   -- promo_codes_none_waives_something
-- ============================================================
