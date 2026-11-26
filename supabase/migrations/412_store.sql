-- ============================================================
-- FFSA Hub — Migration 412: Hub Store
-- ============================================================
-- A general store run by the Media team: digital products read in an
-- in-browser flipbook, yearly subscriptions, physical merch (sizes, stock,
-- delivery / collect at base / preorder) and Print + Digital bundles.
-- Products are DATA: staff add and edit them in /store/admin, no deploy.
--
-- NOT APPLIED. Vercel previews share the production database, so applying
-- this anywhere is Jack's call. Run it by hand in the SQL Editor.
--
-- What this migration does NOT do, on purpose:
--   * no catalogue, order or user rows. The first product (Year-End Review
--     2026) is added in the admin after this is applied.
--   * no broad grant of store.manage. TODO(services): when the
--     Departments/Services work lands, own the store through
--     service_key 'store' / owned('store', 'media') and grant from there,
--     instead of a second ownership model here.
--
-- Access model
--   * Staff: public.is_admin() OR has_permission('store.manage') read and
--     write everything. store.view reads only.
--   * Buyers: a plain Supabase auth user (magic link). They get NO users row
--     and NO user_roles, so nothing in the staff Hub opens for them. They read
--     their own orders / entitlements / devices / codes, matched on
--     auth.uid() or their verified auth email. Every write a buyer makes goes
--     through a route handler using the service role after server-side checks
--     (cart totals, paid state and entitlements are never trusted from the
--     client).
--   * Anonymous: published products, their variants and preview page rows.
--   * Storage: three PRIVATE buckets. Nobody but the service role reads them;
--     pages leave only through the watermarking route.
-- ============================================================

BEGIN;

-- ────────────────────────────────────────────────────────────
-- 0. Permissions catalogue (follows 161_brand_kit_view_permission.sql)
-- ────────────────────────────────────────────────────────────
-- module = 'store' matches the nav module id in src/config/modules.ts.
INSERT INTO public.permissions (module, key, display_name, sort_order) VALUES
  ('store', 'store.view',   'View the Store admin (orders, products)', 10),
  ('store', 'store.manage', 'Run the Store (products, PDFs, orders, fulfilment)', 20)
ON CONFLICT (key) DO NOTHING;

-- Helpers: one place for the staff rule, so every policy says the same thing.
CREATE OR REPLACE FUNCTION public.store_can_manage()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT public.is_admin() OR public.has_permission('store.manage');
$$;

CREATE OR REPLACE FUNCTION public.store_can_view()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT public.store_can_manage() OR public.has_permission('store.view');
$$;

-- The signed-in buyer's verified email, lower-cased ('' when anonymous).
CREATE OR REPLACE FUNCTION public.store_buyer_email()
RETURNS text
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

GRANT EXECUTE ON FUNCTION public.store_can_manage() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.store_can_view() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.store_buyer_email() TO anon, authenticated, service_role;

-- ────────────────────────────────────────────────────────────
-- 1. Catalogue
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.store_products (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                 text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title                text NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  subtitle             text,
  description          text,
  -- digital: flipbook only · subscription: yearly flipbook access ·
  -- physical: merch · bundle: Print + Digital (print copy + flipbook + watermarked PDF)
  kind                 text NOT NULL CHECK (kind IN ('digital', 'subscription', 'physical', 'bundle')),
  status               text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  price_cents          integer NOT NULL CHECK (price_cents >= 0),
  currency             text NOT NULL DEFAULT 'ZAR' CHECK (currency = 'ZAR'),
  cover_image_url      text,
  subscription_months  integer CHECK (subscription_months IS NULL OR subscription_months BETWEEN 1 AND 36),
  -- Physical / bundle only
  ships                boolean NOT NULL DEFAULT false,
  allow_delivery       boolean NOT NULL DEFAULT false,
  allow_collect        boolean NOT NULL DEFAULT false,
  delivery_fee_cents   integer NOT NULL DEFAULT 0 CHECK (delivery_fee_cents >= 0),
  is_preorder          boolean NOT NULL DEFAULT false,
  preorder_ships_on    date,
  -- Gifts and group code packs
  allow_gift           boolean NOT NULL DEFAULT true,
  allow_code_packs     boolean NOT NULL DEFAULT false,
  sort_order           integer NOT NULL DEFAULT 100,
  created_by           uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (kind <> 'subscription' OR subscription_months IS NOT NULL),
  CHECK (NOT ships OR allow_delivery OR allow_collect)
);
CREATE INDEX IF NOT EXISTS store_products_status_idx ON public.store_products (status, sort_order);

CREATE TABLE IF NOT EXISTS public.store_variants (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id   uuid NOT NULL REFERENCES public.store_products (id) ON DELETE CASCADE,
  label        text NOT NULL CHECK (length(label) BETWEEN 1 AND 60),   -- "M", "XL", "Black / L"
  sku          text,
  price_cents  integer CHECK (price_cents IS NULL OR price_cents >= 0), -- NULL = product price
  -- NULL = not tracked (unlimited). Never below zero: settle refuses to oversell.
  stock        integer CHECK (stock IS NULL OR stock >= 0),
  active       boolean NOT NULL DEFAULT true,
  sort_order   integer NOT NULL DEFAULT 100,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, label)
);
CREATE INDEX IF NOT EXISTS store_variants_product_idx ON public.store_variants (product_id, sort_order);

-- A product's uploaded PDF. One active asset per product; replacing the PDF
-- adds a new asset and flips is_active.
CREATE TABLE IF NOT EXISTS public.store_assets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    uuid NOT NULL REFERENCES public.store_products (id) ON DELETE CASCADE,
  source_path   text NOT NULL,             -- store-source/<product>/<asset>.pdf
  filename      text,                      -- as uploaded, for the admin page
  byte_size     bigint CHECK (byte_size > 0 AND byte_size <= 52428800), -- declared at sign time; 50 MB max
  page_count    integer NOT NULL DEFAULT 0, -- pages rendered so far, then the total
  -- awaiting_upload: signed URL issued, browser still uploading straight to
  -- Storage (PDFs never go through a route: Vercel's 4.5 MB body limit).
  status        text NOT NULL DEFAULT 'awaiting_upload' CHECK (status IN ('awaiting_upload', 'uploaded', 'rendering', 'ready', 'failed')),
  error         text,
  render_started_at timestamptz,
  is_active     boolean NOT NULL DEFAULT false,
  uploaded_by   uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  ready_at      timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS store_assets_one_active_idx
  ON public.store_assets (product_id) WHERE is_active;

CREATE TABLE IF NOT EXISTS public.store_asset_pages (
  asset_id    uuid NOT NULL REFERENCES public.store_assets (id) ON DELETE CASCADE,
  page_no     integer NOT NULL CHECK (page_no >= 1),
  path        text NOT NULL,               -- store-pages/<asset>/<page>.webp
  width       integer NOT NULL,
  height      integer NOT NULL,
  is_preview  boolean NOT NULL DEFAULT false,
  PRIMARY KEY (asset_id, page_no)
);

-- ────────────────────────────────────────────────────────────
-- 2. Orders
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.store_orders (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference            text NOT NULL UNIQUE,      -- "ST-7K3Q9P": EFT reference + email subject
  buyer_email          text NOT NULL CHECK (buyer_email = lower(buyer_email)),
  buyer_name           text NOT NULL,
  buyer_phone          text,
  buyer_user_id        uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  status               text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled', 'refunded')),
  payment_method       text NOT NULL CHECK (payment_method IN ('payfast', 'eft')),
  subtotal_cents       integer NOT NULL CHECK (subtotal_cents >= 0),
  delivery_cents       integer NOT NULL DEFAULT 0 CHECK (delivery_cents >= 0),
  total_cents          integer NOT NULL CHECK (total_cents >= 0),
  fulfilment_method    text NOT NULL DEFAULT 'none' CHECK (fulfilment_method IN ('none', 'delivery', 'collect')),
  delivery_address     jsonb,
  provider_payment_id  text,
  eft_proof_path       text,                       -- store-source/eft/<order>.<ext> (private)
  paid_at              timestamptz,
  marked_paid_by       uuid REFERENCES public.users (id) ON DELETE SET NULL,
  cancelled_at         timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (total_cents = subtotal_cents + delivery_cents),
  CHECK (fulfilment_method <> 'delivery' OR delivery_address IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS store_orders_email_idx ON public.store_orders (buyer_email, status);
CREATE INDEX IF NOT EXISTS store_orders_user_idx ON public.store_orders (buyer_user_id);
CREATE INDEX IF NOT EXISTS store_orders_status_idx ON public.store_orders (status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.store_order_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          uuid NOT NULL REFERENCES public.store_orders (id) ON DELETE CASCADE,
  product_id        uuid NOT NULL REFERENCES public.store_products (id),
  variant_id        uuid REFERENCES public.store_variants (id),
  title             text NOT NULL,              -- snapshot at purchase
  variant_label     text,
  quantity          integer NOT NULL CHECK (quantity BETWEEN 1 AND 500),
  unit_price_cents  integer NOT NULL CHECK (unit_price_cents >= 0),
  purpose           text NOT NULL DEFAULT 'self' CHECK (purpose IN ('self', 'gift', 'code_pack')),
  gift_recipient_email text CHECK (gift_recipient_email IS NULL OR gift_recipient_email = lower(gift_recipient_email)),
  gift_message      text CHECK (gift_message IS NULL OR length(gift_message) <= 500),
  CHECK (purpose <> 'gift' OR gift_recipient_email IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS store_order_items_order_idx ON public.store_order_items (order_id);

-- ────────────────────────────────────────────────────────────
-- 3. Access: entitlements, gift / pack codes, devices
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.store_entitlements (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id     uuid NOT NULL REFERENCES public.store_products (id),
  email          text NOT NULL CHECK (email = lower(email)),
  user_id        uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  source         text NOT NULL CHECK (source IN ('purchase', 'gift', 'code', 'staff')),
  order_item_id  uuid REFERENCES public.store_order_items (id) ON DELETE SET NULL,
  code_id        uuid,
  -- Print + Digital only: may download the per-buyer watermarked low-res PDF.
  includes_pdf   boolean NOT NULL DEFAULT false,
  starts_at      timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz,                  -- subscriptions
  revoked_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS store_entitlements_email_idx ON public.store_entitlements (email);
CREATE INDEX IF NOT EXISTS store_entitlements_user_idx ON public.store_entitlements (user_id);
-- An order item grants one entitlement for its own buyer, at most.
CREATE UNIQUE INDEX IF NOT EXISTS store_entitlements_item_self_idx
  ON public.store_entitlements (order_item_id) WHERE source = 'purchase';

-- A gift is a code sent to one recipient; a pack is N codes the buyer hands out.
CREATE TABLE IF NOT EXISTS public.store_codes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code             text NOT NULL UNIQUE CHECK (code ~ '^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$'),
  kind             text NOT NULL CHECK (kind IN ('gift', 'pack')),
  product_id       uuid NOT NULL REFERENCES public.store_products (id),
  order_item_id    uuid NOT NULL REFERENCES public.store_order_items (id) ON DELETE CASCADE,
  recipient_email  text CHECK (recipient_email IS NULL OR recipient_email = lower(recipient_email)),
  includes_pdf     boolean NOT NULL DEFAULT false,
  redeemed_at      timestamptz,
  redeemed_email   text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS store_codes_item_idx ON public.store_codes (order_item_id);

ALTER TABLE public.store_entitlements
  ADD CONSTRAINT store_entitlements_code_fk FOREIGN KEY (code_id) REFERENCES public.store_codes (id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS store_entitlements_code_idx
  ON public.store_entitlements (code_id) WHERE code_id IS NOT NULL;

-- Up to three active reading devices per buyer (enforced in store_register_device).
CREATE TABLE IF NOT EXISTS public.store_devices (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  device_hash   text NOT NULL,                 -- sha256 of the device's random id
  label         text NOT NULL DEFAULT 'This device',
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  removed_at    timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS store_devices_active_idx
  ON public.store_devices (user_id, device_hash) WHERE removed_at IS NULL;

-- ────────────────────────────────────────────────────────────
-- 4. Fulfilment (physical + bundle print copies)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.store_fulfilments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      uuid NOT NULL UNIQUE REFERENCES public.store_orders (id) ON DELETE CASCADE,
  method        text NOT NULL CHECK (method IN ('delivery', 'collect')),
  status        text NOT NULL CHECK (status IN ('preorder', 'to_pack', 'ready_to_collect', 'shipped', 'collected', 'delivered')),
  tracking      text,
  notes         text,
  updated_by    uuid REFERENCES public.users (id) ON DELETE SET NULL,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS store_fulfilments_status_idx ON public.store_fulfilments (status);

-- ────────────────────────────────────────────────────────────
-- 5. Row level security
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.store_products     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_variants     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_assets       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_asset_pages  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_orders       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_order_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_codes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_devices      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_fulfilments  ENABLE ROW LEVEL SECURITY;

-- Catalogue: anyone reads what's published; staff read and write everything.
CREATE POLICY "store products: published are public"
  ON public.store_products FOR SELECT TO anon, authenticated
  USING (status = 'published' OR public.store_can_view());
CREATE POLICY "store products: staff insert"
  ON public.store_products FOR INSERT TO authenticated WITH CHECK (public.store_can_manage());
CREATE POLICY "store products: staff update"
  ON public.store_products FOR UPDATE TO authenticated
  USING (public.store_can_manage()) WITH CHECK (public.store_can_manage());
CREATE POLICY "store products: staff delete"
  ON public.store_products FOR DELETE TO authenticated USING (public.store_can_manage());

CREATE POLICY "store variants: of published products are public"
  ON public.store_variants FOR SELECT TO anon, authenticated
  USING (
    public.store_can_view()
    OR (active AND EXISTS (SELECT 1 FROM public.store_products p WHERE p.id = product_id AND p.status = 'published'))
  );
CREATE POLICY "store variants: staff insert"
  ON public.store_variants FOR INSERT TO authenticated WITH CHECK (public.store_can_manage());
CREATE POLICY "store variants: staff update"
  ON public.store_variants FOR UPDATE TO authenticated
  USING (public.store_can_manage()) WITH CHECK (public.store_can_manage());
CREATE POLICY "store variants: staff delete"
  ON public.store_variants FOR DELETE TO authenticated USING (public.store_can_manage());

-- Assets: staff only (the source path is never shown to buyers).
CREATE POLICY "store assets: staff read"
  ON public.store_assets FOR SELECT TO authenticated USING (public.store_can_view());
CREATE POLICY "store assets: staff insert"
  ON public.store_assets FOR INSERT TO authenticated WITH CHECK (public.store_can_manage());
CREATE POLICY "store assets: staff update"
  ON public.store_assets FOR UPDATE TO authenticated
  USING (public.store_can_manage()) WITH CHECK (public.store_can_manage());
CREATE POLICY "store assets: staff delete"
  ON public.store_assets FOR DELETE TO authenticated USING (public.store_can_manage());

-- Page rows: staff read all. Images themselves only ever leave through the
-- signed, watermarking route, which uses the service role.
CREATE POLICY "store pages: staff read"
  ON public.store_asset_pages FOR SELECT TO authenticated USING (public.store_can_view());
CREATE POLICY "store pages: staff write"
  ON public.store_asset_pages FOR ALL TO authenticated
  USING (public.store_can_manage()) WITH CHECK (public.store_can_manage());

-- Orders: buyer reads own; staff read all; staff update (mark EFT paid,
-- cancel). Inserts come from the checkout route (service role).
CREATE POLICY "store orders: buyer reads own, staff read all"
  ON public.store_orders FOR SELECT TO authenticated
  USING (
    public.store_can_view()
    OR buyer_user_id = auth.uid()
    OR buyer_email = public.store_buyer_email()
  );
CREATE POLICY "store orders: staff update"
  ON public.store_orders FOR UPDATE TO authenticated
  USING (public.store_can_manage()) WITH CHECK (public.store_can_manage());

CREATE POLICY "store order items: buyer reads own, staff read all"
  ON public.store_order_items FOR SELECT TO authenticated
  USING (
    public.store_can_view()
    OR EXISTS (
      SELECT 1 FROM public.store_orders o
      WHERE o.id = order_id
        AND (o.buyer_user_id = auth.uid() OR o.buyer_email = public.store_buyer_email())
    )
  );

CREATE POLICY "store entitlements: holder reads own, staff read all"
  ON public.store_entitlements FOR SELECT TO authenticated
  USING (public.store_can_view() OR user_id = auth.uid() OR email = public.store_buyer_email());
CREATE POLICY "store entitlements: staff write"
  ON public.store_entitlements FOR ALL TO authenticated
  USING (public.store_can_manage()) WITH CHECK (public.store_can_manage());

-- Codes: the buyer who paid for them reads them (to hand pack codes out);
-- staff read all. Redemption goes through the server.
CREATE POLICY "store codes: purchaser reads own, staff read all"
  ON public.store_codes FOR SELECT TO authenticated
  USING (
    public.store_can_view()
    OR EXISTS (
      SELECT 1 FROM public.store_order_items i
      JOIN public.store_orders o ON o.id = i.order_id
      WHERE i.id = order_item_id
        AND o.status = 'paid'
        AND (o.buyer_user_id = auth.uid() OR o.buyer_email = public.store_buyer_email())
    )
  );

-- Devices: the buyer sees and removes their own. Registering goes through
-- store_register_device (limit check).
CREATE POLICY "store devices: own read"
  ON public.store_devices FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.store_can_manage());
CREATE POLICY "store devices: own remove"
  ON public.store_devices FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.store_can_manage())
  WITH CHECK (user_id = auth.uid() OR public.store_can_manage());

CREATE POLICY "store fulfilments: buyer reads own, staff read all"
  ON public.store_fulfilments FOR SELECT TO authenticated
  USING (
    public.store_can_view()
    OR EXISTS (
      SELECT 1 FROM public.store_orders o
      WHERE o.id = order_id
        AND (o.buyer_user_id = auth.uid() OR o.buyer_email = public.store_buyer_email())
    )
  );
CREATE POLICY "store fulfilments: staff write"
  ON public.store_fulfilments FOR ALL TO authenticated
  USING (public.store_can_manage()) WITH CHECK (public.store_can_manage());

-- Table privileges: anon reads the catalogue only.
REVOKE ALL ON TABLE
  public.store_products, public.store_variants, public.store_assets, public.store_asset_pages,
  public.store_orders, public.store_order_items, public.store_entitlements, public.store_codes,
  public.store_devices, public.store_fulfilments
FROM anon;
GRANT SELECT ON TABLE public.store_products, public.store_variants TO anon;

-- ────────────────────────────────────────────────────────────
-- 6. Atomic helpers (service role only)
-- ────────────────────────────────────────────────────────────
-- Take stock for one variant, refusing to go below zero. Returns false when
-- there isn't enough (the caller flags the order for Media to sort out).
CREATE OR REPLACE FUNCTION public.store_take_stock(p_variant_id uuid, p_quantity integer)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_rows integer;
BEGIN
  UPDATE public.store_variants
     SET stock = stock - p_quantity
   WHERE id = p_variant_id
     AND (stock IS NULL OR stock >= p_quantity);
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$$;

-- Register (or touch) a reading device, at most p_limit active per user.
-- Returns 'ok' or 'limit'. Serialised per user with an advisory lock so two
-- devices racing can't both take the third slot.
CREATE OR REPLACE FUNCTION public.store_register_device(
  p_user_id uuid, p_device_hash text, p_label text, p_limit integer DEFAULT 3
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_active integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('store_devices:' || p_user_id::text));

  UPDATE public.store_devices
     SET last_seen_at = now()
   WHERE user_id = p_user_id AND device_hash = p_device_hash AND removed_at IS NULL;
  IF FOUND THEN RETURN 'ok'; END IF;

  SELECT count(*) INTO v_active
    FROM public.store_devices
   WHERE user_id = p_user_id AND removed_at IS NULL;
  IF v_active >= p_limit THEN RETURN 'limit'; END IF;

  INSERT INTO public.store_devices (user_id, device_hash, label)
  VALUES (p_user_id, p_device_hash, left(coalesce(nullif(p_label, ''), 'This device'), 80));
  RETURN 'ok';
END;
$$;

REVOKE ALL ON FUNCTION public.store_take_stock(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.store_register_device(uuid, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.store_take_stock(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.store_register_device(uuid, text, text, integer) TO service_role;

-- ────────────────────────────────────────────────────────────
-- 7. Storage — all private
-- ────────────────────────────────────────────────────────────
--   store-source : uploaded PDFs + EFT proofs. Never served. 50 MB cap
--                  (matches MAX_PDF_BYTES in src/lib/store/upload.ts).
--   store-pages  : rendered WebP pages. Served only watermarked, via route.
--   store-covers : cover images. Private too; served by /api/store/cover.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES
  ('store-source', 'store-source', false, 52428800,  ARRAY['application/pdf', 'image/jpeg', 'image/png']),
  ('store-pages',  'store-pages',  false, 10485760,  ARRAY['image/webp', 'application/pdf']),
  ('store-covers', 'store-covers', false, 5242880,   ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public             = false,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;
-- No storage.objects policies: only the service role touches these buckets.

COMMIT;

-- ============================================================
-- Validation (run after applying)
-- ------------------------------------------------------------
--   SELECT key FROM public.permissions WHERE module = 'store';
--     -- expect store.view, store.manage
--   SELECT relname, relrowsecurity FROM pg_class
--    WHERE relname LIKE 'store\_%' AND relkind = 'r';
--     -- expect relrowsecurity = true on all ten
--   SELECT id, public FROM storage.buckets WHERE id LIKE 'store-%';
--     -- expect three rows, public = false
-- ============================================================
