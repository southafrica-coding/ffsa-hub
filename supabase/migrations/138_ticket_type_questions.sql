-- ============================================================
-- FFSA Hub — Migration 138: per-tier ticket questions
-- ============================================================
-- Extends the custom-checkout-questions idea (migration 094) from
-- event-level / once-per-order down to the ticket TIER, asked once per
-- TICKET. Example: a "Kids" tier asks the child's name + age band for
-- each kids ticket in the cart.
--
-- Three columns:
--   - ticket_types.questions : the question schema attached to THIS tier.
--     A flat JSON array of FormField-shaped objects (see
--     src/lib/forms/schema.ts — id, type, label, required, options?,
--     helpText?, parentFieldId?, showWhenValue?). Empty array = the tier
--     asks nothing extra (default). Same shape + validator as
--     events.checkout_questions, so the builder/renderer are reused.
--   - orders.ticket_answers : per-ticket answers captured at checkout,
--     held on the pending order until fulfilment issues the tickets.
--     Array of { ticket_type_id, answers: [{ id, label, value }] } — one
--     entry per ticket whose tier has questions. Fulfilment drains this
--     onto each issued ticket's custom_answers.
--   - tickets.custom_answers : the answers for THIS issued ticket, as a
--     self-describing snapshot [{ id, label, value }] so the admin /
--     attendee export stays correct even if the tier's questions change.
--
-- These are additive to the event-level checkout_questions (094): an
-- event can use event-wide per-order questions, per-tier per-ticket
-- questions, or both.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS. Safe to re-run.
-- ============================================================

ALTER TABLE public.ticket_types
  ADD COLUMN IF NOT EXISTS questions jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS ticket_answers jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS custom_answers jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.ticket_types.questions IS
  'Per-tier custom questions asked once per ticket at checkout. Flat JSON array of FormField-shaped objects (see src/lib/forms/schema.ts). Empty = none.';
COMMENT ON COLUMN public.orders.ticket_answers IS
  'Per-ticket answers captured at checkout, held until fulfilment. Array of { ticket_type_id, answers: [{ id, label, value }] }, one entry per ticket whose tier has questions.';
COMMENT ON COLUMN public.tickets.custom_answers IS
  'Answers to the ticket tier''s questions for this issued ticket. Snapshot array of { id, label, value } so it stays readable if the tier''s questions change.';

-- ============================================================
-- Validation
-- ------------------------------------------------------------
--   SELECT table_name, column_name, data_type, column_default
--   FROM information_schema.columns
--   WHERE (table_name = 'ticket_types' AND column_name = 'questions')
--      OR (table_name = 'orders'       AND column_name = 'ticket_answers')
--      OR (table_name = 'tickets'      AND column_name = 'custom_answers');
--   -- expect 3 rows, all jsonb defaulting to '[]'
-- ============================================================
