-- ============================================================
-- FFSA Hub — Migration 142: Communications asset permissions
-- ============================================================
-- Adds two grantable Communications permissions so a non-admin can manage
-- Labels and Brand Kits without the full comms_admin role:
--   • communications.manage_labels     — create / rename / delete labels
--   • communications.manage_brand_kits — edit sending-identity brand kits
--
-- Both feature pages live under /communications and were previously gated by
-- the comms_admin ROLE only (RLS + the /api route guards). This makes the
-- grant actually enforce: the manage policies now also honor has_permission().
-- (The /api routes are updated in the same PR to pass the matching key to
-- canManageComms.)
--
-- Seeds under module='communications' so they render in the Communications
-- card of the permission manager automatically (grouping is by module).
-- ============================================================

-- 1. Permission catalog rows.
INSERT INTO public.permissions (module, key, display_name, sort_order) VALUES
  ('communications', 'communications.manage_labels',     'Manage labels',     260),
  ('communications', 'communications.manage_brand_kits', 'Manage brand kits', 270)
ON CONFLICT (key) DO NOTHING;

-- 2. RLS — let holders of the new permissions manage the underlying tables.
--    (contact_labels — tagging contacts — is intentionally NOT widened here;
--    that stays a comms_admin / events_admin action.)
DROP POLICY IF EXISTS "Admins and comms can manage labels" ON public.labels;
CREATE POLICY "Admins and comms can manage labels"
  ON public.labels FOR ALL
  USING (
    public.is_admin()
    OR public.has_role('comms_admin')
    OR public.has_permission('communications.manage_labels')
  )
  WITH CHECK (
    public.is_admin()
    OR public.has_role('comms_admin')
    OR public.has_permission('communications.manage_labels')
  );

DROP POLICY IF EXISTS "Admins and comms can manage brand kits" ON public.sending_identity_brands;
CREATE POLICY "Admins and comms can manage brand kits"
  ON public.sending_identity_brands FOR ALL
  USING (
    public.is_admin()
    OR public.has_role('comms_admin')
    OR public.has_permission('communications.manage_brand_kits')
  )
  WITH CHECK (
    public.is_admin()
    OR public.has_role('comms_admin')
    OR public.has_permission('communications.manage_brand_kits')
  );

-- ============================================================
-- Validation (run after applying)
-- ------------------------------------------------------------
--   SELECT key, module FROM public.permissions
--    WHERE key IN ('communications.manage_labels','communications.manage_brand_kits');
--   -- as a user granted only communications.manage_labels:
--   --   has_permission('communications.manage_labels')     -> true
--   --   an UPDATE on public.labels succeeds; on sending_identity_brands fails
-- ============================================================
