-- ============================================================
-- FFSA Hub — Migration 120: Ticket sales → Xero invoices
-- ============================================================
-- When a ticket order is paid (Stripe or PayFast webhook), post a
-- PAID sales invoice into Xero — mirroring how vehicle rentals and
-- school billing already route income via an `xero_item_code`
-- (see services/xero.ts).
--
--   events.xero_item_code   — per-event Xero item code, edited in the
--                             event's Ticketing settings. Its presence
--                             is the opt-in: no code ⇒ no invoice.
--   orders.xero_invoice_id  — Xero InvoiceID written back on success.
--   orders.xero_invoice_number — human-facing Xero invoice number.
--   orders.xero_synced_at   — timestamp of the successful post; doubles
--                             as an idempotency guard alongside
--                             xero_invoice_id (never post twice).
--
-- The item code drives the ledger account + tax in Xero, and the
-- payment is applied against XERO_ZA_BANK_ACCOUNT_CODE so the invoice
-- reads PAID (money is already collected at point of sale). The
-- ticketing webhooks use the service-role client, so no public write
-- policy is needed here. Idempotent — safe to re-run. Requires
-- migration 057 (orders) and 001 (events).
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Per-event Xero item code (opt-in switch for ticket invoicing)
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.events ADD COLUMN IF NOT EXISTS xero_item_code text;

-- ────────────────────────────────────────────────────────────
-- 2. Xero invoice reference on the order
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS xero_invoice_id text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS xero_invoice_number text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS xero_synced_at timestamptz;

-- Verify:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'events' AND column_name = 'xero_item_code';
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'orders'
--      AND column_name IN ('xero_invoice_id','xero_invoice_number','xero_synced_at');
