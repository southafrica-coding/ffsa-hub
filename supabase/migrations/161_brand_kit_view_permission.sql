-- ============================================================
-- FFSA Hub — Migration 161: Brand Kit view permission
-- ============================================================
-- The "Brand Kit" nav module (/brand-kit) — the static FFSA brand reference
-- (palette, type, logos, voice) — was previously OPEN to every authenticated
-- user (requiredRoles: [] in src/config/modules.ts, and only a login check on
-- the page). This adds a grantable permission so access can be assigned per
-- role / per user instead of being general.
--
-- Seeded under module='brand-kit' (NOT 'communications') so it matches the nav
-- module id 'brand-kit'. The nav-visibility engine (getAccessibleModules) and
-- the page guard (requireModuleAccess) both key off the permission's `module`
-- column against the ModuleDefinition `id`, so the module name must be exactly
-- 'brand-kit' for the grant to unlock the item.
--
-- Intentionally NOT assigned to any role: it starts unassigned and admins /
-- super_admins still see Brand Kit via the is_admin() bypass already present in
-- getAccessibleModules and requireModuleAccess. No RLS is needed — the page
-- reads only static data from src/lib/brand/ffsa.ts, not a table.
-- ============================================================

INSERT INTO public.permissions (module, key, display_name, sort_order) VALUES
  ('brand-kit', 'brand_kit.view', 'View Brand Kit', 10)
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- Validation (run after applying)
-- ------------------------------------------------------------
--   SELECT module, key, display_name FROM public.permissions
--    WHERE key = 'brand_kit.view';
--   -- expect one row: module='brand-kit', display_name='View Brand Kit'
-- ============================================================
