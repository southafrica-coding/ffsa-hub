-- ════════════════════════════════════════════════════════════
-- 238 — Event "pay later": buy tickets on a Xero invoice
-- ════════════════════════════════════════════════════════════
-- Per event, staff can offer buyers "Invoice me, pay later" next to the
-- card buttons. The order holds its seats, the buyer is emailed a Xero
-- invoice (paid online, in full or in parts), and the tickets are issued
-- only once Xero shows the invoice fully paid.
--
-- The invoice lines post to the event's Xero Item (events.xero_item_code),
-- which carries the sales account (Event Registration Revenue) and tax.
-- That column already exists in production from the unmerged ticket→Xero
-- PR (#47, migration 120) — re-added idempotently so main has it too.
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS xero_item_code     text,
  ADD COLUMN IF NOT EXISTS pay_later_enabled  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pay_later_due_date date;

COMMENT ON COLUMN public.events.xero_item_code IS
  'Xero Item code (in the org matching the event currency: ZAR→SA, USD→US) that ticket invoices post to.';
COMMENT ON COLUMN public.events.pay_later_enabled IS
  'Offer "Invoice me, pay later" at checkout. Needs xero_item_code.';
COMMENT ON COLUMN public.events.pay_later_due_date IS
  'Due date on pay-later invoices. NULL = the event start date.';

-- ── orders: new status + provider, Xero invoice link ─────────
-- Drop whatever CHECKs currently guard status / payment_provider (names
-- differ between environments) and re-create them with the new values.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.orders'::regclass AND contype = 'c'
      AND (pg_get_constraintdef(oid) ILIKE '%status%IN%'
           OR pg_get_constraintdef(oid) ILIKE '%payment_provider%')
      AND pg_get_constraintdef(oid) NOT ILIKE '%contact_resolution%'
  LOOP
    EXECUTE format('ALTER TABLE public.orders DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_status_check CHECK (status IN (
    'pending', 'invoiced', 'paid', 'expired', 'cancelled', 'refunded', 'partially_refunded'
  )),
  ADD CONSTRAINT orders_payment_provider_check CHECK (
    payment_provider IS NULL OR payment_provider IN ('payfast', 'stripe', 'invoice')
  );

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS xero_invoice_id         text,
  ADD COLUMN IF NOT EXISTS xero_invoice_number     text,
  ADD COLUMN IF NOT EXISTS xero_region             text CHECK (xero_region IS NULL OR xero_region IN ('za', 'us')),
  ADD COLUMN IF NOT EXISTS invoice_due_date        date,
  ADD COLUMN IF NOT EXISTS invoice_paid_cents      integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS invoice_emailed_at      timestamptz,
  ADD COLUMN IF NOT EXISTS invoice_error           text;

CREATE INDEX IF NOT EXISTS idx_orders_xero_invoice
  ON public.orders (xero_invoice_id) WHERE xero_invoice_id IS NOT NULL;

COMMENT ON COLUMN public.orders.invoice_paid_cents IS
  'Pay-later orders: what Xero shows paid so far (part payments). Tickets issue at full payment.';

-- Verify:
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conrelid = 'public.orders'::regclass AND contype = 'c';
--   SELECT pay_later_enabled, pay_later_due_date, xero_item_code FROM public.events LIMIT 1;
