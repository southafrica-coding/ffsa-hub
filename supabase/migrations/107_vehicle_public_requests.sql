-- ============================================================
-- FFSA Hub — Migration 107: Public "Request a Vehicle" link
-- ============================================================
-- Lets the Vehicle Coordinator take requests from people who are NOT in
-- the Hub, via a single pasteable link (WhatsApp / email / posters).
--
-- Two changes, both additive:
--
--   1. vehicle_request_link_settings — singleton (id=1) holding the active
--      public-link slug + on/off toggle, mirroring 075_public_signup_code's
--      shape. The slug is the secret segment in
--      /request-vehicle/<slug>; regenerating swaps it in place so the old
--      link dies immediately. Starts DISABLED.
--
--   2. vehicle_bookings gains `source` (internal vs public) so external
--      submissions are visibly flagged in the approvals queue, and
--      `submitted_ip` for the public endpoint's per-IP rate limit.
--
-- The public page + submit endpoint read these through the service-role
-- admin client (bypasses RLS), exactly like /api/public/signup. Manager
-- read/write goes through the session client under the policies below.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. vehicle_request_link_settings  (singleton)
-- ────────────────────────────────────────────────────────────

CREATE TABLE public.vehicle_request_link_settings (
  id          smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled     boolean NOT NULL DEFAULT false,   -- off until a manager turns it on
  slug        text NOT NULL UNIQUE,             -- secret segment in /request-vehicle/<slug>
  intro_note  text,                             -- optional blurb shown atop the public form
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES public.users (id) ON DELETE SET NULL
);

COMMENT ON TABLE public.vehicle_request_link_settings IS
  'Singleton row holding the active public vehicle-request link slug + toggle. Used by /request-vehicle/<slug>.';

-- Seed one row, disabled, with a random 24-char URL-safe slug
-- (gen_random_uuid() → hex → strip dashes → first 24 chars, as in 075).
INSERT INTO public.vehicle_request_link_settings (id, enabled, slug)
VALUES (
  1,
  false,
  substring(replace(gen_random_uuid()::text, '-', ''), 1, 24)
)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.vehicle_request_link_settings ENABLE ROW LEVEL SECURITY;

-- Managers (or admins) read + manage the link via their session. Public
-- reads/writes go through the service-role admin client and bypass RLS.
CREATE POLICY "vehicle_link_read" ON public.vehicle_request_link_settings
  FOR SELECT TO authenticated
  USING (public.is_admin() OR public.has_permission('vehicles.manage'));

CREATE POLICY "vehicle_link_write" ON public.vehicle_request_link_settings
  FOR ALL TO authenticated
  USING (public.is_admin() OR public.has_permission('vehicles.manage'))
  WITH CHECK (public.is_admin() OR public.has_permission('vehicles.manage'));

-- ────────────────────────────────────────────────────────────
-- 2. vehicle_bookings — flag external submissions + capture IP
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.vehicle_bookings
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'internal'
    CHECK (source IN ('internal', 'public'));

ALTER TABLE public.vehicle_bookings
  ADD COLUMN IF NOT EXISTS submitted_ip text;

-- Supports the public endpoint's "recent submissions from this IP" rate-limit.
CREATE INDEX IF NOT EXISTS idx_vehicle_bookings_ip_created
  ON public.vehicle_bookings (submitted_ip, created_at);

-- ============================================================
-- Validation (run in the Supabase SQL Editor after applying)
-- ------------------------------------------------------------
--   SELECT id, enabled, length(slug) FROM public.vehicle_request_link_settings;
--   -- expect: 1 | false | 24
--
--   SELECT column_name, data_type, column_default
--     FROM information_schema.columns
--    WHERE table_name = 'vehicle_bookings'
--      AND column_name IN ('source', 'submitted_ip');
--   -- expect: source / text / 'internal'::text  ·  submitted_ip / text / null
--
--   SELECT policyname, cmd FROM pg_policies
--    WHERE tablename = 'vehicle_request_link_settings';
-- ============================================================
