-- ============================================================
-- FFSA Hub — Migration 157: Legal / Compliance role + nav permission
-- ============================================================
-- Adds the `legal` module permission and the `legal_admin` role that
-- unlocks the Legal / Consents console — a read-only view of who has
-- signed which policy (consent_records), for FFSA's legal office.
--
-- legal_admin is NOT a full admin (is_admin() stays false for it), so the
-- console reads cross-user data via the service-role client behind a role
-- gate in the page. super_admin / admin also see the console (their
-- requiredRoles include it) and retain all their other access.
--
-- Pattern copied from migration 127 (ministry_leader). is_system = false so
-- it surfaces in the normal Roles UI and can be assigned to legal staff.
-- ============================================================

-- 1. Nav permission for the Legal module.
INSERT INTO public.permissions (module, key, display_name, sort_order)
VALUES ('legal', 'legal.access', 'Access Legal / Consents', 10)
ON CONFLICT (key) DO NOTHING;

-- 2. The role.
INSERT INTO public.roles (name, display_name, description, is_system)
VALUES (
  'legal_admin',
  'Legal / Compliance',
  'Views the Legal / Consents console: who has signed which policy and version, across staff and public applicants, with view / print / CSV export. Read-only; not a full administrator.',
  false
)
ON CONFLICT (name) DO NOTHING;

-- 3. Bundle: legal_admin -> legal.access (unlocks the nav module).
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
JOIN public.permissions p ON p.key = 'legal.access'
WHERE r.name = 'legal_admin'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ============================================================
-- Validation (run after applying)
-- ------------------------------------------------------------
--   SELECT key FROM public.permissions WHERE module = 'legal';      -- legal.access
--   SELECT name, is_system FROM public.roles WHERE name = 'legal_admin';
--   SELECT p.key FROM public.role_permissions rp
--     JOIN public.roles r ON r.id = rp.role_id
--     JOIN public.permissions p ON p.id = rp.permission_id
--    WHERE r.name = 'legal_admin';                                   -- legal.access
-- ============================================================
