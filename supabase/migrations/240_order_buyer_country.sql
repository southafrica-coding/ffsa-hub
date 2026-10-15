-- ════════════════════════════════════════════════════════════
-- 240 — Pay-later buyers are invoiced by their country
-- ════════════════════════════════════════════════════════════
-- "Invoice me, pay later" now asks the buyer's country, and that picks the
-- Xero org that invoices them, the same rule as Training: USA → FF SA USA,
-- Inc; everyone else → Fire & Fragrance SA NPC. The invoice stays in the
-- event's currency (both orgs take ZAR and USD). Card orders don't ask, so
-- this stays NULL for them; orders.xero_region (migration 238) still records
-- the org actually used.
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS buyer_country text;

COMMENT ON COLUMN public.orders.buyer_country IS
  'Pay-later orders: the buyer''s country, which picks the invoicing Xero org (USA → us, else za).';

COMMENT ON COLUMN public.events.xero_item_code IS
  'Xero Item code that pay-later ticket invoices post to — the same code in BOTH orgs, since buyers are invoiced in their own country''s org.';

-- Verify:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'orders' AND column_name = 'buyer_country';
