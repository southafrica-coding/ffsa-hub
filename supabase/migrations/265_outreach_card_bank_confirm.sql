-- ────────────────────────────────────────────────────────────
-- 265 — Card payments confirmed by the bank notification
--
-- A card payment abroad is first recorded at an estimated rate. The
-- real rand only shows on the bank's notification, so a card expense in
-- a foreign currency now carries:
--
--   zar_confirmed      true once the rand came from the bank (notification
--                      screenshot in Slack, or typed from the bank app)
--   zar_estimate       what it was first recorded at, kept for the record
--   bank_proof_path    the notification screenshot (also filed as a receipt)
--   zar_confirmed_at   when
--
-- Rand card payments need no confirming. A foreign-transaction fee the
-- bank shows separately becomes its own Bank Costs expense, linked by
-- fee_for_expense_id (like a cash pull's fee, migration 263).
--
-- A notification sent on its own, after the receipt, waits as a draft of
-- kind 'card_confirm' until the sender picks which payment it belongs to.
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.outreach_expenses
  ADD COLUMN IF NOT EXISTS zar_confirmed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS zar_estimate numeric(14,2),
  ADD COLUMN IF NOT EXISTS bank_proof_path text,
  ADD COLUMN IF NOT EXISTS zar_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS fee_for_expense_id uuid
    REFERENCES public.outreach_expenses(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS uq_oe_fee_for_expense
  ON public.outreach_expenses(fee_for_expense_id) WHERE fee_for_expense_id IS NOT NULL;

-- What's waiting for a bank notification, per person (the morning reminder).
CREATE INDEX IF NOT EXISTS idx_oe_card_unconfirmed
  ON public.outreach_expenses(created_by)
  WHERE payment_method = 'card' AND local_currency <> 'ZAR' AND NOT zar_confirmed;

-- Rand is rand: existing card payments in ZAR, and fees made from pulls,
-- are already exact.
UPDATE public.outreach_expenses
SET zar_confirmed = true
WHERE NOT zar_confirmed AND (local_currency = 'ZAR' OR fee_for_batch_id IS NOT NULL);

ALTER TABLE public.outreach_receipt_drafts
  DROP CONSTRAINT IF EXISTS outreach_receipt_drafts_kind_check;
ALTER TABLE public.outreach_receipt_drafts
  ADD CONSTRAINT outreach_receipt_drafts_kind_check
  CHECK (kind IN ('receipt', 'cash_pull', 'card_confirm'));

-- The expense a card_confirm draft confirmed.
ALTER TABLE public.outreach_receipt_drafts
  ADD COLUMN IF NOT EXISTS confirmed_expense_id uuid
  REFERENCES public.outreach_expenses(id) ON DELETE SET NULL;
