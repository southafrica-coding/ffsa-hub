-- ============================================================
-- FFSA Hub — Migration 207: Module visibility (beta gating)
-- ============================================================
-- Lets a super admin hide a module from the whole Hub while it is still
-- being built or tested, without ripping it out of the code or the nav.
--
-- Three states, keyed on ModuleDefinition.id in src/config/modules.ts:
--   'live'   — normal behaviour: the existing role/permission rules decide.
--   'beta'   — super admins ONLY. Invisible in the nav and 404 on the route
--              for everyone else, including plain `admin`. That divergence is
--              deliberate: "still being tested by super admins only".
--   'hidden' — nobody, super admins included. A kill switch for a module that
--              is actively broken.
--
-- Every current module is seeded 'live', so applying this changes nothing
-- until someone flips a switch.
--
-- The key is a plain text id, not an FK — the module list lives in code, and
-- a row for a module that no longer exists is harmless (it is simply never
-- looked up). Rows are upserted by the admin UI rather than pre-constrained,
-- so a module added to code later needs no migration.
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.module_visibility (
  key         text PRIMARY KEY,
  visibility  text NOT NULL DEFAULT 'live'
              CHECK (visibility IN ('live', 'beta', 'hidden')),
  -- Optional "what is being tested / why is this off" note, shown to super
  -- admins on the settings page and in the in-module BETA banner.
  note        text,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.module_visibility IS
  'Per-module rollout state. Keys match ModuleDefinition.id in src/config/modules.ts.';

-- Seed every module that exists in code today, all 'live'.
INSERT INTO public.module_visibility (key, visibility) VALUES
  ('dashboard', 'live'),
  ('contacts', 'live'),
  ('communications', 'live'),
  ('events', 'live'),
  ('bookings', 'live'),
  ('schools', 'live'),
  ('teams', 'live'),
  ('org-chart', 'live'),
  ('finance', 'live'),
  ('prayer-room', 'live'),
  ('mission', 'live'),
  ('ministry', 'live'),
  ('okrs', 'live'),
  ('brand-kit', 'live'),
  ('records-library', 'live'),
  ('users', 'live'),
  ('legal', 'live'),
  ('roles', 'live'),
  ('settings', 'live'),
  ('slack', 'live'),
  ('modules', 'live')
ON CONFLICT (key) DO NOTHING;

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
-- Readable by every authenticated user: the admin layout reads this table on
-- each render to build the nav, for everyone, not just admins. Knowing that a
-- module id exists and is in beta leaks nothing — the gate is what matters.
--
-- Writes go through createAdminClient() in the API route (service role, which
-- bypasses RLS) and are gated on super_admin there. A super-admin-only UPDATE
-- policy is included anyway so the table is not writable from a user session
-- even if someone later reaches it with the anon client.
ALTER TABLE public.module_visibility ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS module_visibility_select_authenticated ON public.module_visibility;
CREATE POLICY module_visibility_select_authenticated
  ON public.module_visibility FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS module_visibility_write_super_admin ON public.module_visibility;
CREATE POLICY module_visibility_write_super_admin
  ON public.module_visibility FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_roles ur
      JOIN public.roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid()
        AND r.name = 'super_admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.user_roles ur
      JOIN public.roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid()
        AND r.name = 'super_admin'
    )
  );

-- ============================================================
-- Validation
-- ------------------------------------------------------------
--   SELECT count(*) FROM public.module_visibility;          -- 21
--   SELECT count(*) FROM public.module_visibility
--    WHERE visibility <> 'live';                            -- 0
--   SELECT relname, relrowsecurity FROM pg_class
--    WHERE relname = 'module_visibility';                   -- t
-- ============================================================
