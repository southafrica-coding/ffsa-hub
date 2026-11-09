-- ============================================================
-- FFSA Hub — Migration 311: Evangelism open to everyone
-- ============================================================
-- Jack (FFSA) wants the evangelism gate as open as possible so every
-- signed-in Hub user can view, submit and publish stories.
--
-- self_service is the baseline role every account gets. See
-- 115_baseline_self_service_access.sql and
-- 191_space_bookings_view_for_everyone.sql, which use the same pattern.
--
-- 310 is reserved by open PR #536. main ends at 309. This file is NOT
-- applied. Do not run it until Jack says so.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Grant evangelism view, submit and publish onto self_service.
--    Same shape as 115 (lines 30–36).
-- ────────────────────────────────────────────────────────────
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
JOIN public.permissions p
  ON p.key IN ('evangelism.view', 'evangelism.submit', 'evangelism.publish')
WHERE r.name = 'self_service'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 2. Defensive backfill: any public.users row that lacks self_service
--    gets it. Mirrors 115's NOT EXISTS pattern (NULL scope columns make
--    ON CONFLICT unreliable). Idempotent. Column list matches 115.
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
