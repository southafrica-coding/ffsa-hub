-- ============================================================
-- FFSA Hub — Migration 238: Stripe ticket sales → US Xero invoices
-- ============================================================
-- Every ticket order paid through Stripe posts a PAID sales invoice
-- into the US Xero organisation (FF SA USA, Inc), built line-by-line
-- from the order exactly as charged. Refunds post a credit note plus a
-- cash refund against it. PayFast orders stay out of Xero.
--
--   events.xero_item_code        — per-event US Xero item code; drives
--                                  the revenue account. Blank ⇒ falls
--                                  back to XERO_US_TICKET_ACCOUNT_CODE.
--   orders.xero_invoice_id       — Xero InvoiceID written back on
--                                  success; the idempotency guard
--                                  (never invoice an order twice).
--   orders.xero_invoice_number   — human-facing Xero invoice number.
--   orders.xero_synced_at        — when the invoice was posted.
--   orders.xero_sync_error       — last failure, shown on the order so
--                                  staff can see it and retry. Cleared
--                                  on success.
--   order_refunds.xero_credit_note_id — credit note posted for this
--                                  refund (idempotency for refunds).
--
-- Webhooks use the service-role client, so no new policies are needed.
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE public.events ADD COLUMN IF NOT EXISTS xero_item_code text;

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS xero_invoice_id text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS xero_invoice_number text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS xero_synced_at timestamptz;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS xero_sync_error text;

ALTER TABLE public.order_refunds ADD COLUMN IF NOT EXISTS xero_credit_note_id text;

-- Verify:
--   SELECT table_name, column_name FROM information_schema.columns
--    WHERE (table_name = 'events' AND column_name = 'xero_item_code')
--       OR (table_name = 'orders' AND column_name LIKE 'xero_%')
--       OR (table_name = 'order_refunds' AND column_name = 'xero_credit_note_id');
