-- ============================================================
-- FFSA Hub — Migration 134: Per-user dashboard layouts
-- ============================================================
-- The dashboard is built from a WIDGET REGISTRY in application code
-- (src/lib/dashboard/widget-registry.ts). This table stores only each
-- user's PREFERENCE over that registry: which widgets they want shown,
-- and in what order.
--
-- `layout` is an ordered JSONB array of { key, enabled }:
--
--   [{"key": "notification-feed", "enabled": true},
--    {"key": "schools-counts",    "enabled": true},
--    {"key": "staff-workload",    "enabled": false}]
--
-- Order in the array IS the display order. No row for a user means
-- "registry defaults" — we never seed this table.
--
-- IMPORTANT: a stored layout is a preference, never an authorisation.
-- Every widget's own API route re-checks permission server-side, so
-- enabling a widget you lack access to yields an empty widget, not data.
-- ============================================================

CREATE TABLE public.dashboard_layouts (
  user_id    uuid PRIMARY KEY REFERENCES public.users (id) ON DELETE CASCADE,
  layout     jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- Guard against a malformed write turning the dashboard into a crash.
  -- The registry validates keys; this just pins the shape.
  CONSTRAINT dashboard_layouts_layout_is_array
    CHECK (jsonb_typeof(layout) = 'array')
);

ALTER TABLE public.dashboard_layouts ENABLE ROW LEVEL SECURITY;

-- A user only ever sees and manages their own layout. There is no
-- admin-reads-everyone policy on purpose: this is personal preference
-- data with no operational value to anyone else.
CREATE POLICY "dashboard_layouts_own_select" ON public.dashboard_layouts
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "dashboard_layouts_own_write" ON public.dashboard_layouts
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.dashboard_layouts
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
