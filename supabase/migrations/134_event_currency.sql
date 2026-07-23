-- ============================================================
-- FFSA Hub — Per-event selling currency (ZAR + USD)
-- ============================================================
-- Ticketing has been ZAR-only since migration 057: orders.currency
-- existed but nothing ever wrote anything other than 'ZAR', and
-- ticket prices, storefronts and emails all assumed rands.
--
-- Staff can now pick the selling currency per event. Two pieces of
-- schema make that safe:
--
--   1. events.currency — the currency a given event sells in. One
--      currency per event; an order snapshots it into orders.currency
--      at checkout, so historical orders always render correctly even
--      if the event is later re-priced.
--
--   2. payment_fee_profiles.currency — the gross-up ("fee-inclusive")
--      pricing function adds a FIXED fee component on top of a
--      percentage. R3.00 is not $3.00, so a single global profile per
--      provider would gross up dollar prices by a rand-sized fee.
--      Rates are now per (provider, currency).
--
-- PayFast is deliberately given NO non-ZAR row: it is a South African
-- ZAR-only processor (src/lib/payments/payfast.ts takes no currency
-- at all). The absence of a row is what makes it ineligible, and the
-- app layer mirrors this in providersForCurrency() in
-- src/lib/currencies.ts.
--
-- Every existing event and fee profile defaults to ZAR, so applying
-- this migration changes no current behaviour.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. events.currency
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'ZAR';

ALTER TABLE public.events
  DROP CONSTRAINT IF EXISTS events_currency_check;

ALTER TABLE public.events
  ADD CONSTRAINT events_currency_check CHECK (currency IN ('ZAR', 'USD'));

COMMENT ON COLUMN public.events.currency IS
  'ISO 4217 code this event sells tickets in. Ticket prices, promo amounts and orders are all in this currency''s minor units. Non-ZAR events are Stripe-only (PayFast is ZAR-only).';


-- ────────────────────────────────────────────────────────────
-- 2. payment_fee_profiles — rates are now per (provider, currency)
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.payment_fee_profiles
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'ZAR';

-- The original table declared `provider text NOT NULL UNIQUE`, which
-- would now reject a second row for the same provider in another
-- currency. Swap it for the composite key.
ALTER TABLE public.payment_fee_profiles
  DROP CONSTRAINT IF EXISTS payment_fee_profiles_provider_key;

CREATE UNIQUE INDEX IF NOT EXISTS payment_fee_profiles_provider_currency_key
  ON public.payment_fee_profiles (provider, currency);

COMMENT ON COLUMN public.payment_fee_profiles.currency IS
  'ISO 4217 code these rates apply to. A provider with no row for a currency cannot be used to sell in it — this is how PayFast is kept ZAR-only.';

-- Stripe USD — 2.9% + $0.30. Placeholder, exactly like the ZAR rows
-- seeded in 057: finance must confirm against the live Stripe contract.
INSERT INTO public.payment_fee_profiles (provider, currency, percent_bps, fixed_cents)
VALUES ('stripe', 'USD', 290, 30)
ON CONFLICT (provider, currency) DO NOTHING;


-- ────────────────────────────────────────────────────────────
-- 3. Refresh now-stale "ZAR cents" column comments
-- ────────────────────────────────────────────────────────────
COMMENT ON COLUMN public.ticket_types.target_net_cents IS
  'Amount FFSA intends to keep after processor fees, in the minor units of the parent event''s currency. Staff input.';
COMMENT ON COLUMN public.ticket_types.display_price_cents IS
  'Grossed-up price the buyer sees and pays, in the minor units of the parent event''s currency. Computed from target_net_cents at save time. For pwyw, the minimum.';
COMMENT ON COLUMN public.orders.currency IS
  'ISO 4217 code, snapshotted from events.currency at checkout so an order always renders in the currency it was actually sold in.';


-- ────────────────────────────────────────────────────────────
-- Verify (run manually after applying)
-- ────────────────────────────────────────────────────────────
--   SELECT currency, count(*) FROM public.events GROUP BY 1;
--     -- expect every existing row 'ZAR'
--   SELECT provider, currency, percent_bps, fixed_cents
--     FROM public.payment_fee_profiles ORDER BY currency, provider;
--     -- expect payfast/ZAR, stripe/ZAR, stripe/USD  (3 rows)
