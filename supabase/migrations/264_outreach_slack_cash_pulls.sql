-- ────────────────────────────────────────────────────────────
-- 264 — Cash pulls from a Slack bank screenshot
--
-- The receipt bot now also reads bank notifications for ATM withdrawals.
-- A draft is either a receipt (→ an expense) or a cash pull (→ an
-- outreach_cash_batches row, priced exactly as in migration 263, with the
-- screenshot kept as proof_path).
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.outreach_receipt_drafts
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'receipt';

ALTER TABLE public.outreach_receipt_drafts
  DROP CONSTRAINT IF EXISTS outreach_receipt_drafts_kind_check;
ALTER TABLE public.outreach_receipt_drafts
  ADD CONSTRAINT outreach_receipt_drafts_kind_check CHECK (kind IN ('receipt', 'cash_pull'));

-- The pull a logged cash-pull draft became.
ALTER TABLE public.outreach_receipt_drafts
  ADD COLUMN IF NOT EXISTS cash_batch_id uuid
  REFERENCES public.outreach_cash_batches(id) ON DELETE SET NULL;
