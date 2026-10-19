-- ============================================================
-- FFSA Hub — Migration 255: Equipment hire + asset register (handoff file 110)
-- ============================================================
-- One module, two doors: the public storefront (/hire) and the
-- staff tools (/bookings/equipment). Design: turns 44–47.
-- Spec: docs/redesign/19-equipment-hire.md
--
--   PRODUCTS are what customers see (price, photos, listing).
--   UNITS are physical things with a tag (AUD-0014), serial, status.
--   ORDERS book a QUANTITY of a product. Units are attached when
--   the warehouse scans tags at packing — never at booking time.
--
-- Money is integer ZAR cents, prices stored EXCL. VAT.
-- Permissions (module = 'equipment'):
--   equipment.view     — see the register and orders
--   equipment.request  — ministry wings: book at internal rate (needs approval)
--   equipment.operate  — warehouse: pack, scan, hand over, check in, log damage
--   equipment.manage   — rental manager: prices, listings, approvals, deductions
-- is_admin() / has_permission() / ministries already exist (002, 015, 088).
-- ============================================================

CREATE OR REPLACE FUNCTION public.has_equipment_access()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_admin()
      OR public.has_permission('equipment.view')
      OR public.has_permission('equipment.request')
      OR public.has_permission('equipment.operate')
      OR public.has_permission('equipment.manage');
$$;

CREATE OR REPLACE FUNCTION public.can_manage_equipment()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_admin() OR public.has_permission('equipment.manage');
$$;

CREATE OR REPLACE FUNCTION public.can_operate_equipment()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_admin() OR public.has_permission('equipment.manage')
      OR public.has_permission('equipment.operate');
$$;

-- ────────────────────────────────────────────────────────────
-- 1. PLACES AND CATEGORIES
-- ────────────────────────────────────────────────────────────

CREATE TABLE public.equipment_locations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,                       -- "Auditorium"
  slug        text NOT NULL UNIQUE,
  parent_id   uuid REFERENCES public.equipment_locations (id),  -- "sound cupboard" inside Auditorium
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Store categories (Sound › Microphones). Separate from the register's
-- broad category so the store can be reorganised without touching assets.
CREATE TABLE public.equipment_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  slug        text NOT NULL UNIQUE,
  parent_id   uuid REFERENCES public.equipment_categories (id),
  blurb       text,
  sort_order  integer NOT NULL DEFAULT 0,
  is_visible  boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ────────────────────────────────────────────────────────────
-- 2. PRODUCTS (what customers see)
-- ────────────────────────────────────────────────────────────

CREATE TABLE public.equipment_products (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seed_key             text UNIQUE,                -- import join key; null for hand-made products
  name                 text NOT NULL,              -- "Vocal microphone"
  brand                text,
  model                text,
  slug                 text NOT NULL UNIQUE,
  register_category    text NOT NULL DEFAULT 'audio',   -- audio / visual / auxiliary / … free text on purpose
  store_category_id    uuid REFERENCES public.equipment_categories (id),
  owner_ministry_id    uuid REFERENCES public.ministries (id),
  description          text,
  included             text[] NOT NULL DEFAULT '{}',    -- "Stand clip", "XLR cable, 5 m"
  specs                jsonb NOT NULL DEFAULT '{}',     -- {"Type":"Dynamic, cardioid"}
  -- Listing. A product is on the store only when is_listed AND can_leave_building.
  can_leave_building   boolean NOT NULL DEFAULT false,
  is_listed            boolean NOT NULL DEFAULT false,
  listed_at            timestamptz,
  price_day_cents      integer,                    -- null = no price = cannot list
  price_weekend_cents  integer,                    -- Fri–Mon counts as one weekend
  price_week_cents     integer,
  deposit_cents        integer NOT NULL DEFAULT 0, -- per unit
  internal_day_cents   integer NOT NULL DEFAULT 0, -- ministry rate; 0 = free
  max_per_order        integer,                    -- null = no cap beyond stock
  sort_order           integer NOT NULL DEFAULT 0,
  created_by           uuid REFERENCES public.users (id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT listed_needs_price CHECK (NOT is_listed OR (price_day_cents IS NOT NULL AND can_leave_building))
);

CREATE TABLE public.equipment_product_photos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  uuid NOT NULL REFERENCES public.equipment_products (id) ON DELETE CASCADE,
  file_path   text NOT NULL,                      -- bucket equipment-photos (public)
  alt         text,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Kits: a product made of other products. Availability = min over parts.
CREATE TABLE public.equipment_kit_parts (
  kit_id      uuid NOT NULL REFERENCES public.equipment_products (id) ON DELETE CASCADE,
  part_id     uuid NOT NULL REFERENCES public.equipment_products (id),
  quantity    integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  PRIMARY KEY (kit_id, part_id)
);
ALTER TABLE public.equipment_products ADD COLUMN is_kit boolean NOT NULL DEFAULT false;

-- "Frequently rented with" — hand-picked now, computed from orders later.
CREATE TABLE public.equipment_related (
  product_id  uuid NOT NULL REFERENCES public.equipment_products (id) ON DELETE CASCADE,
  related_id  uuid NOT NULL REFERENCES public.equipment_products (id) ON DELETE CASCADE,
  sort_order  integer NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, related_id)
);

-- ────────────────────────────────────────────────────────────
-- 3. UNITS (what we track)
-- ────────────────────────────────────────────────────────────
-- Stored status is only what a person decides: available / maintenance / retired.
-- "Reserved" and "out" are derived from orders — see equipment_unit_state.

CREATE TABLE public.equipment_units (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id            uuid NOT NULL REFERENCES public.equipment_products (id),
  tag                   text NOT NULL UNIQUE,      -- AUD-0014, printed as QR
  label                 text,                      -- "PM3", "26P6K" — what's written on it
  serial                text,
  status                text NOT NULL DEFAULT 'available'
                        CHECK (status IN ('available', 'maintenance', 'retired')),
  condition             text,                      -- free text from the sheet: "Brand new", "Internal wifi busted"
  condition_note        text,
  location_id           uuid REFERENCES public.equipment_locations (id),
  owner_ministry_id     uuid REFERENCES public.ministries (id),  -- null = product's owner
  supplier              text,
  purchase_date         date,
  purchase_price_cents  integer,
  warranty_until        date,
  last_checked_on       date,
  tag_printed_at        timestamptz,
  source                jsonb,                     -- {"sheet","tab","row"} for imports
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_equipment_units_product ON public.equipment_units (product_id);
CREATE INDEX idx_equipment_units_status  ON public.equipment_units (status);

-- ────────────────────────────────────────────────────────────
-- 4. ORDERS
-- ────────────────────────────────────────────────────────────

CREATE SEQUENCE public.equipment_order_number_seq START 100;

CREATE TABLE public.equipment_orders (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number                 text NOT NULL UNIQUE
                         DEFAULT 'FFH-' || lpad(nextval('public.equipment_order_number_seq')::text, 4, '0'),
  kind                   text NOT NULL DEFAULT 'external' CHECK (kind IN ('external', 'internal')),
  status                 text NOT NULL DEFAULT 'quote'
                         CHECK (status IN ('quote', 'requested', 'confirmed', 'prepping', 'out',
                                           'returned', 'inspected', 'closed', 'declined', 'cancelled')),
  -- who
  customer_user_id       uuid REFERENCES public.users (id),
  customer_name          text NOT NULL,
  customer_email         text NOT NULL,
  customer_phone         text,
  customer_org           text,
  ministry_id            uuid REFERENCES public.ministries (id),   -- internal orders
  -- when (collect → return). Availability is by calendar day, inclusive.
  starts_on              date NOT NULL,
  ends_on                date NOT NULL CHECK (ends_on >= starts_on),
  collect_time           time,
  return_time            time,
  rate_period            text NOT NULL DEFAULT 'day' CHECK (rate_period IN ('day', 'weekend', 'week')),
  fulfilment             text NOT NULL DEFAULT 'collect' CHECK (fulfilment IN ('collect', 'delivery')),
  delivery_address       text,
  -- money, cents. Totals are snapshots written at confirmation.
  subtotal_cents         integer NOT NULL DEFAULT 0,
  waiver_cents           integer NOT NULL DEFAULT 0,
  vat_cents              integer NOT NULL DEFAULT 0,
  total_cents            integer NOT NULL DEFAULT 0,
  deposit_cents          integer NOT NULL DEFAULT 0,
  -- checks
  id_verified_at         timestamptz,
  agreement_version      text,
  agreement_accepted_at  timestamptz,
  agreement_signed_name  text,
  approved_by            uuid REFERENCES public.users (id),
  approved_at            timestamptz,
  decline_reason         text,
  access_token           text NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', ''),  -- emailed link, no login needed
  notes                  text,
  created_by             uuid REFERENCES public.users (id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_equipment_orders_dates  ON public.equipment_orders (starts_on, ends_on);
CREATE INDEX idx_equipment_orders_status ON public.equipment_orders (status);

CREATE TABLE public.equipment_order_lines (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          uuid NOT NULL REFERENCES public.equipment_orders (id) ON DELETE CASCADE,
  product_id        uuid NOT NULL REFERENCES public.equipment_products (id),
  quantity          integer NOT NULL CHECK (quantity > 0),
  unit_price_cents  integer NOT NULL DEFAULT 0,    -- per unit for the whole period
  deposit_cents     integer NOT NULL DEFAULT 0,    -- per unit
  line_total_cents  integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_equipment_lines_order   ON public.equipment_order_lines (order_id);
CREATE INDEX idx_equipment_lines_product ON public.equipment_order_lines (product_id);

-- Units attached by scanning. One row per unit per order.
CREATE TABLE public.equipment_order_units (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          uuid NOT NULL REFERENCES public.equipment_orders (id) ON DELETE CASCADE,
  line_id           uuid NOT NULL REFERENCES public.equipment_order_lines (id) ON DELETE CASCADE,
  unit_id           uuid NOT NULL REFERENCES public.equipment_units (id),
  packed_at         timestamptz NOT NULL DEFAULT now(),
  packed_by         uuid REFERENCES public.users (id),
  handed_over_at    timestamptz,
  returned_at       timestamptz,
  checked_in_by     uuid REFERENCES public.users (id),
  return_condition  text CHECK (return_condition IN ('fine', 'damaged', 'missing')),
  return_note       text,
  UNIQUE (order_id, unit_id)
);
-- A unit can only be physically out on one order at a time.
CREATE UNIQUE INDEX idx_equipment_unit_one_open
  ON public.equipment_order_units (unit_id) WHERE returned_at IS NULL;

-- ────────────────────────────────────────────────────────────
-- 5. HISTORY, MAINTENANCE, DEDUCTIONS, FILES, PAYMENTS
-- ────────────────────────────────────────────────────────────

CREATE TABLE public.equipment_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id     uuid REFERENCES public.equipment_units (id) ON DELETE CASCADE,
  order_id    uuid REFERENCES public.equipment_orders (id) ON DELETE SET NULL,
  kind        text NOT NULL,   -- imported, packed, out, returned, damaged, missing, repair_opened, repair_closed, moved, edited, retired
  detail      text,
  actor_id    uuid REFERENCES public.users (id),
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_equipment_events_unit ON public.equipment_events (unit_id, at DESC);

CREATE TABLE public.equipment_maintenance (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id          uuid NOT NULL REFERENCES public.equipment_units (id) ON DELETE CASCADE,
  status           text NOT NULL DEFAULT 'reported'
                   CHECK (status IN ('reported', 'at_repairer', 'done', 'written_off')),
  reason           text NOT NULL,
  source_order_id  uuid REFERENCES public.equipment_orders (id),
  repairer         text,
  cost_cents       integer,
  due_back_on      date,           -- the calendar blocks the unit until this date (or forever if null)
  opened_by        uuid REFERENCES public.users (id),
  opened_at        timestamptz NOT NULL DEFAULT now(),
  closed_by        uuid REFERENCES public.users (id),
  closed_at        timestamptz
);
CREATE INDEX idx_equipment_maint_open ON public.equipment_maintenance (unit_id) WHERE status IN ('reported', 'at_repairer');

-- Proposed by the warehouse at check-in, confirmed by the rental manager.
CREATE TABLE public.equipment_deductions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      uuid NOT NULL REFERENCES public.equipment_orders (id) ON DELETE CASCADE,
  unit_id       uuid REFERENCES public.equipment_units (id),
  kind          text NOT NULL CHECK (kind IN ('damage', 'missing', 'late')),
  amount_cents  integer NOT NULL CHECK (amount_cents >= 0),
  note          text,
  status        text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'confirmed', 'waived')),
  proposed_by   uuid REFERENCES public.users (id),
  decided_by    uuid REFERENCES public.users (id),
  decided_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Condition photos and the customer's signature. Bucket equipment-inspections (private).
CREATE TABLE public.equipment_files (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid REFERENCES public.equipment_orders (id) ON DELETE CASCADE,
  unit_id     uuid REFERENCES public.equipment_units (id) ON DELETE CASCADE,
  moment      text NOT NULL CHECK (moment IN ('handover', 'return', 'repair', 'unit')),
  kind        text NOT NULL CHECK (kind IN ('photo', 'signature', 'document')),
  file_path   text NOT NULL,
  file_name   text,
  uploaded_by uuid REFERENCES public.users (id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Mirrors vehicle_payments (105). Hire and deposit are separate charges.
CREATE TABLE public.equipment_payments (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id             uuid NOT NULL REFERENCES public.equipment_orders (id) ON DELETE CASCADE,
  kind                 text NOT NULL CHECK (kind IN ('hire', 'deposit', 'deposit_refund', 'deduction')),
  amount_cents         integer NOT NULL,
  currency             text NOT NULL DEFAULT 'ZAR',
  status               text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'paid', 'cancelled', 'failed', 'refunded')),
  payment_provider     text NOT NULL DEFAULT 'payfast',
  provider_reference   text,
  provider_payment_id  text,
  xero_item_code       text,
  xero_invoice_id      text,
  xero_invoice_number  text,
  paid_at              timestamptz,
  created_by           uuid REFERENCES public.users (id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_equipment_payments_ref
  ON public.equipment_payments (provider_reference) WHERE provider_reference IS NOT NULL;

-- One row of settings, edited on the Pricing page.
CREATE TABLE public.equipment_settings (
  id                     boolean PRIMARY KEY DEFAULT true CHECK (id),
  vat_bps                integer NOT NULL DEFAULT 1500,   -- 15.00%
  waiver_bps             integer NOT NULL DEFAULT 1000,   -- 10.00% of hire, optional per order later
  waiver_cover_cents     integer NOT NULL DEFAULT 500000, -- R 5 000
  late_fee_rule          text NOT NULL DEFAULT 'day_rate_per_day',
  deposit_refund_days    integer NOT NULL DEFAULT 3,
  agreement_version      text NOT NULL DEFAULT '2026-11',
  xero_item_code         text,
  updated_at             timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.equipment_settings (id) VALUES (true) ON CONFLICT DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 6. AVAILABILITY
-- ────────────────────────────────────────────────────────────
-- Statuses that HOLD stock. A quote holds nothing.
CREATE OR REPLACE FUNCTION public.equipment_holding_statuses()
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['requested', 'confirmed', 'prepping', 'out', 'returned']::text[];
$$;

-- Free units of a product on the worst day of [p_from, p_to].
-- Bookable = units with status 'available' (maintenance and retired never count).
-- p_ignore_order lets the cart/edit flow re-check an order against everyone else.
CREATE OR REPLACE FUNCTION public.equipment_free_count(
  p_product uuid, p_from date, p_to date, p_ignore_order uuid DEFAULT NULL
) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH stock AS (
    SELECT count(*)::int AS n FROM equipment_units
    WHERE product_id = p_product AND status = 'available'
  ), days AS (
    SELECT d::date AS day FROM generate_series(p_from, p_to, interval '1 day') d
  ), held AS (
    SELECT days.day,
      (SELECT coalesce(sum(l.quantity), 0)::int
         FROM equipment_order_lines l
         JOIN equipment_orders o ON o.id = l.order_id
        WHERE l.product_id = p_product
          AND o.status = ANY (equipment_holding_statuses())
          AND days.day BETWEEN o.starts_on AND o.ends_on
          AND (p_ignore_order IS NULL OR o.id <> p_ignore_order)) AS q
    FROM days
  )
  SELECT greatest(0, (SELECT n FROM stock) - coalesce((SELECT max(q) FROM held), 0));
$$;

-- Kits: free = min over parts of floor(part_free / part_qty). Done in
-- services/equipment.ts (freeCountForKit) so the cart can explain which part ran out.

-- Per-day free counts for the item-page calendar.
CREATE OR REPLACE FUNCTION public.equipment_free_by_day(p_product uuid, p_from date, p_to date)
RETURNS TABLE (day date, free integer) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT d::date, public.equipment_free_count(p_product, d::date, d::date)
  FROM generate_series(p_from, p_to, interval '1 day') d;
$$;

-- Live state for the register: available / reserved / out / maintenance / retired.
-- security_invoker so the units/order RLS above applies to whoever reads it
-- (a plain view runs as its owner and would hand the register to anon). See 166.
CREATE OR REPLACE VIEW public.equipment_unit_state WITH (security_invoker = true) AS
SELECT u.*,
  CASE
    WHEN u.status <> 'available' THEN u.status
    WHEN ou.handed_over_at IS NOT NULL THEN 'out'
    WHEN ou.id IS NOT NULL THEN 'reserved'
    ELSE 'available'
  END AS live_status,
  ou.order_id AS current_order_id
FROM public.equipment_units u
LEFT JOIN public.equipment_order_units ou ON ou.unit_id = u.id AND ou.returned_at IS NULL;

-- ────────────────────────────────────────────────────────────
-- 7. PERMISSIONS
-- ────────────────────────────────────────────────────────────

INSERT INTO public.permissions (module, key, display_name, sort_order) VALUES
  ('equipment', 'equipment.view',    'View Equipment & Orders',               10),
  ('equipment', 'equipment.request', 'Book Equipment for a Ministry',         20),
  ('equipment', 'equipment.operate', 'Warehouse: Pack, Scan, Check In',       30),
  ('equipment', 'equipment.manage',  'Rental Manager: Prices, Approvals',     40)
ON CONFLICT (key) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 8. ROW LEVEL SECURITY
-- ────────────────────────────────────────────────────────────
-- Public storefront reads listed products through anon policies.
-- Public checkout, PayFast ITN and tokenised order pages use the
-- service-role client in API routes (same pattern as 105).

ALTER TABLE public.equipment_locations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipment_categories     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipment_products       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipment_product_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipment_kit_parts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipment_related        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipment_units          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipment_orders         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipment_order_lines    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipment_order_units    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipment_events         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipment_maintenance    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipment_deductions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipment_files          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipment_payments       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipment_settings       ENABLE ROW LEVEL SECURITY;

-- Store-facing reads (anon + authenticated)
CREATE POLICY eq_cat_public   ON public.equipment_categories FOR SELECT USING (is_visible OR public.has_equipment_access());
CREATE POLICY eq_prod_public  ON public.equipment_products   FOR SELECT USING (is_listed OR public.has_equipment_access());
CREATE POLICY eq_photo_public ON public.equipment_product_photos FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.equipment_products p WHERE p.id = product_id AND (p.is_listed OR public.has_equipment_access())));
CREATE POLICY eq_kit_public   ON public.equipment_kit_parts  FOR SELECT USING (true);
CREATE POLICY eq_rel_public   ON public.equipment_related    FOR SELECT USING (true);
CREATE POLICY eq_set_read     ON public.equipment_settings   FOR SELECT USING (true);

-- Staff reads
CREATE POLICY eq_loc_read   ON public.equipment_locations   FOR SELECT TO authenticated USING (public.has_equipment_access());
CREATE POLICY eq_unit_read  ON public.equipment_units       FOR SELECT TO authenticated USING (public.has_equipment_access());
CREATE POLICY eq_event_read ON public.equipment_events      FOR SELECT TO authenticated USING (public.has_equipment_access());
CREATE POLICY eq_maint_read ON public.equipment_maintenance FOR SELECT TO authenticated USING (public.has_equipment_access());
CREATE POLICY eq_file_read  ON public.equipment_files       FOR SELECT TO authenticated USING (public.has_equipment_access());
CREATE POLICY eq_ou_read    ON public.equipment_order_units FOR SELECT TO authenticated USING (public.has_equipment_access());
CREATE POLICY eq_order_read ON public.equipment_orders      FOR SELECT TO authenticated
  USING (public.has_equipment_access() OR customer_user_id = auth.uid());
CREATE POLICY eq_line_read  ON public.equipment_order_lines FOR SELECT TO authenticated
  USING (public.has_equipment_access() OR EXISTS (
    SELECT 1 FROM public.equipment_orders o WHERE o.id = order_id AND o.customer_user_id = auth.uid()));
CREATE POLICY eq_pay_read   ON public.equipment_payments    FOR SELECT TO authenticated
  USING (public.can_manage_equipment() OR EXISTS (
    SELECT 1 FROM public.equipment_orders o WHERE o.id = order_id AND o.customer_user_id = auth.uid()));
CREATE POLICY eq_ded_read   ON public.equipment_deductions  FOR SELECT TO authenticated
  USING (public.has_equipment_access() OR EXISTS (
    SELECT 1 FROM public.equipment_orders o WHERE o.id = order_id AND o.customer_user_id = auth.uid()));

-- Writes: manager owns catalogue + money; warehouse owns the physical side.
CREATE POLICY eq_cat_w   ON public.equipment_categories     FOR ALL TO authenticated USING (public.can_manage_equipment()) WITH CHECK (public.can_manage_equipment());
CREATE POLICY eq_prod_w  ON public.equipment_products       FOR ALL TO authenticated USING (public.can_manage_equipment()) WITH CHECK (public.can_manage_equipment());
CREATE POLICY eq_photo_w ON public.equipment_product_photos FOR ALL TO authenticated USING (public.can_manage_equipment()) WITH CHECK (public.can_manage_equipment());
CREATE POLICY eq_kit_w   ON public.equipment_kit_parts      FOR ALL TO authenticated USING (public.can_manage_equipment()) WITH CHECK (public.can_manage_equipment());
CREATE POLICY eq_rel_w   ON public.equipment_related        FOR ALL TO authenticated USING (public.can_manage_equipment()) WITH CHECK (public.can_manage_equipment());
CREATE POLICY eq_set_w   ON public.equipment_settings       FOR ALL TO authenticated USING (public.can_manage_equipment()) WITH CHECK (public.can_manage_equipment());
CREATE POLICY eq_pay_w   ON public.equipment_payments       FOR ALL TO authenticated USING (public.can_manage_equipment()) WITH CHECK (public.can_manage_equipment());
CREATE POLICY eq_loc_w   ON public.equipment_locations      FOR ALL TO authenticated USING (public.can_operate_equipment()) WITH CHECK (public.can_operate_equipment());
CREATE POLICY eq_unit_w  ON public.equipment_units          FOR ALL TO authenticated USING (public.can_operate_equipment()) WITH CHECK (public.can_operate_equipment());
CREATE POLICY eq_ou_w    ON public.equipment_order_units    FOR ALL TO authenticated USING (public.can_operate_equipment()) WITH CHECK (public.can_operate_equipment());
CREATE POLICY eq_event_w ON public.equipment_events         FOR INSERT TO authenticated WITH CHECK (public.can_operate_equipment());
CREATE POLICY eq_maint_w ON public.equipment_maintenance    FOR ALL TO authenticated USING (public.can_operate_equipment()) WITH CHECK (public.can_operate_equipment());
CREATE POLICY eq_file_w  ON public.equipment_files          FOR ALL TO authenticated USING (public.can_operate_equipment()) WITH CHECK (public.can_operate_equipment());
CREATE POLICY eq_ded_ins ON public.equipment_deductions     FOR INSERT TO authenticated WITH CHECK (public.can_operate_equipment());
CREATE POLICY eq_ded_upd ON public.equipment_deductions     FOR UPDATE TO authenticated USING (public.can_manage_equipment()) WITH CHECK (public.can_manage_equipment());
CREATE POLICY eq_order_w ON public.equipment_orders         FOR ALL TO authenticated
  USING (public.can_operate_equipment() OR (public.has_permission('equipment.request') AND created_by = auth.uid()))
  WITH CHECK (public.can_operate_equipment() OR (public.has_permission('equipment.request') AND created_by = auth.uid() AND kind = 'internal'));
CREATE POLICY eq_line_w  ON public.equipment_order_lines    FOR ALL TO authenticated
  USING (public.can_operate_equipment() OR EXISTS (SELECT 1 FROM public.equipment_orders o WHERE o.id = order_id AND o.created_by = auth.uid() AND o.status IN ('quote','requested')))
  WITH CHECK (public.can_operate_equipment() OR EXISTS (SELECT 1 FROM public.equipment_orders o WHERE o.id = order_id AND o.created_by = auth.uid() AND o.status IN ('quote','requested')));

-- ────────────────────────────────────────────────────────────
-- 9. STORAGE
-- ────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public) VALUES
  ('equipment-photos', 'equipment-photos', true),
  ('equipment-inspections', 'equipment-inspections', false)
ON CONFLICT (id) DO NOTHING;
