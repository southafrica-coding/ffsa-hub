-- ============================================================
-- FFSA Hub — Migration 127: Ministry Leader role + nav permission
-- ============================================================
-- Adds the `ministry` module permission and the `ministry_leader` role
-- that unlocks the Ministry tab. The role is the nav/identity marker; the
-- REAL per-ministry scope lives in ministry_memberships leader rows
-- (migration 126) and is checked via leads_ministry(). The appoint/remove
-- -leader API routes keep the role in sync with those rows: grant it on a
-- user's first leadership, revoke it when their last leader row is gone.
--
-- ministry_leader is is_system=false so it surfaces in the normal role
-- machinery; department/ministry scope does NOT use user_roles.scope
-- (which only supports program/team/event) — it uses the membership rows.
-- Bundle-seed pattern copied from 115.
-- ============================================================

-- 1. Nav permission for the Ministry module.
INSERT INTO public.permissions (module, key, display_name, sort_order)
VALUES ('ministry', 'ministry.access', 'Access Ministry Tab', 10)
ON CONFLICT (key) DO NOTHING;

-- 2. The role.
INSERT INTO public.roles (name, display_name, description, is_system)
VALUES (
  'ministry_leader',
  'Ministry Leader',
  'Leads one or more ministries: manages the ministry roster (add / approve / remove staff) and sets the Point Leader, scoped to their own ministry.',
  false
)
ON CONFLICT (name) DO NOTHING;

-- 3. Bundle: ministry_leader -> ministry.access (unlocks the nav module).
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
JOIN public.permissions p ON p.key = 'ministry.access'
WHERE r.name = 'ministry_leader'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ============================================================
-- Validation (run after applying)
-- ------------------------------------------------------------
--   SELECT key FROM public.permissions WHERE module = 'ministry';   -- ministry.access
--   SELECT name, is_system FROM public.roles WHERE name = 'ministry_leader';
--   SELECT p.key FROM public.role_permissions rp
--     JOIN public.roles r ON r.id = rp.role_id
--     JOIN public.permissions p ON p.id = rp.permission_id
--    WHERE r.name = 'ministry_leader';                              -- ministry.access
-- ============================================================
