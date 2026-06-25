-- ============================================================
-- FFSA Hub — Migration 114: Baseline self-service access
-- ============================================================
-- Establishes the access "floor" every account carries the moment it
-- is created. The self_service role (already auto-assigned at signup /
-- invite / application-accept) becomes the carrier of a small permission
-- bundle, so the floor is auditable + revocable and flows through the
-- existing role-aware RLS (has_permission) and the sidebar nav.
--
-- Floor capabilities for EVERY user (no explicit grant needed):
--   • Dashboard, Prayer Room  — already open (module requiredRoles = [])
--   • Personal finance (/my-finance) — already an open portal page
--   • Space Bookings  — VIEW the schedule/calendar, read-only.
--       bookings.view    ✔ granted   (booking still needs bookings.request)
--   • Rent a Vehicle  — VIEW the fleet + submit a booking request.
--       vehicles.view    ✔ granted
--       vehicles.request ✔ granted   (approving still needs vehicles.approve)
--
-- Everything else (managing spaces/vehicles, admin finance, the org chart,
-- contacts, events, …) stays gated behind an explicit permission/role.
--
-- Built on the role engine (089): purely additive role_permissions rows
-- plus a one-time backfill that guarantees every existing user actually
-- holds the self_service role, so the floor reaches them too.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Bundle the floor capabilities onto the self_service role.
-- ────────────────────────────────────────────────────────────
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
JOIN public.permissions p
  ON p.key IN ('bookings.view', 'vehicles.view', 'vehicles.request')
WHERE r.name = 'self_service'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 2. Backfill: every existing login user must carry the self_service
--    floor role (older accounts predate the auto-assign at signup).
--    Global (NULL) scope. NOT EXISTS guard — NULL scope columns make
--    ON CONFLICT unreliable on the (user_id, role_id, scope_type,
--    scope_id) unique key.
-- ────────────────────────────────────────────────────────────
INSERT INTO public.user_roles (user_id, role_id)
SELECT u.id, r.id
FROM public.users u
CROSS JOIN public.roles r
WHERE r.name = 'self_service'
  AND NOT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = u.id
      AND ur.role_id = r.id
  );

-- ============================================================
-- Validation (run in the Supabase SQL Editor after applying)
-- ------------------------------------------------------------
--   -- floor bundle present (expect bookings.view, vehicles.request, vehicles.view)
--   SELECT p.key
--     FROM public.role_permissions rp
--     JOIN public.roles r       ON r.id = rp.role_id
--     JOIN public.permissions p ON p.id = rp.permission_id
--    WHERE r.name = 'self_service'
--    ORDER BY p.key;
--
--   -- every user now holds self_service (expect 0)
--   SELECT count(*)
--     FROM public.users u
--    WHERE NOT EXISTS (
--      SELECT 1 FROM public.user_roles ur
--        JOIN public.roles r ON r.id = ur.role_id
--       WHERE ur.user_id = u.id AND r.name = 'self_service'
--    );
-- ============================================================
