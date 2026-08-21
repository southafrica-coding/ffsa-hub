-- ============================================================
-- FFSA Hub — Migration 183: OKRs permissions
-- ============================================================
-- The OKRs nav module is open to every authenticated user (requiredRoles: [] in
-- src/config/modules.ts), because ministry OKRs are meant to be seen by the
-- whole base. So nothing here gates the tab. What these permissions exist for
-- is the administrative edges — running cycles, and a grantable override for
-- someone who needs to edit across ministries without sitting on the
-- Leadership Team.
--
-- Seeded under module='okrs' so the id matches the ModuleDefinition — both
-- getAccessibleModules and requireModuleAccess key the permission's `module`
-- column against it.
--
-- NOTE ON THE RLS BOUNDARY. The row-level policies in 182 key off the ROLE
-- 'leadership_team', not off okrs.manage_all. That is deliberate: the role is
-- trigger-synced from active membership of the Leadership Team staff ministry
-- (131_booking_roles_and_leader_access.sql), so it cannot drift from who is
-- actually on the team. okrs.manage_all is an application-layer marker only.
-- ============================================================

INSERT INTO public.permissions (module, key, display_name, sort_order) VALUES
  ('okrs', 'okrs.view',          'View OKRs',                           10),
  ('okrs', 'okrs.manage_cycles', 'Manage OKR Cycles',                   20),
  ('okrs', 'okrs.manage_all',    'Edit Any Ministry or Individual OKR', 30)
ON CONFLICT (key) DO NOTHING;

-- Leadership Team: everything.
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM public.roles r
  JOIN public.permissions p
    ON p.key IN ('okrs.view', 'okrs.manage_cycles', 'okrs.manage_all')
 WHERE r.name = 'leadership_team'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Ministry leaders: view only. Their editing rights are SCOPED to the ministry
-- they lead and come from leads_staff_ministry() in the policies, not from a
-- permission row.
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM public.roles r
  JOIN public.permissions p ON p.key = 'okrs.view'
 WHERE r.name = 'ministry_leader'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- admin / super_admin are not listed: they pass through the is_admin() bypass
-- already present in getAccessibleModules, requireModuleAccess and every policy.

-- ============================================================
-- Validation (run after applying)
-- ------------------------------------------------------------
--   SELECT module, key, display_name, sort_order FROM public.permissions
--    WHERE module = 'okrs' ORDER BY sort_order;
--   -- expect three rows under module='okrs'
--
--   SELECT r.name, p.key
--     FROM public.role_permissions rp
--     JOIN public.roles r       ON r.id = rp.role_id
--     JOIN public.permissions p ON p.id = rp.permission_id
--    WHERE p.module = 'okrs'
--    ORDER BY r.name, p.key;
--   -- expect: leadership_team x3, ministry_leader x1 (okrs.view)
-- ============================================================
