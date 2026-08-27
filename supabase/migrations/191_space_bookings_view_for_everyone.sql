-- ============================================================
-- FFSA Hub — Migration 191: Space Bookings visible to everyone
-- ------------------------------------------------------------
-- Everyone on the Hub should be able to SEE what the offices / rooms are
-- booked for; only ministry leaders (and the booking admin roles) should be
-- able to MAKE bookings.
--
-- Migration 162 removed `bookings.view` from the universal `self_service`
-- floor role, which hid the module from regular staff entirely. This puts it
-- back. Creating a booking still needs `bookings.request`, which only the
-- ministry_leader / leadership_team bundles carry (migration 131), so the
-- read/write split is exactly what we want:
--
--   bookings.view    → self_service (everyone) — calendar + booking details
--   bookings.request → ministry leaders        — create a booking request
--   bookings.approve/manage → booking admins
--
-- Nav visibility, page guards (requireModuleAccess("bookings")) and RLS
-- (has_bookings_access()) all key off holding ANY bookings.* permission, so
-- this single grant restores read access without unlocking anything else.
-- Idempotent.
-- ============================================================

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
JOIN public.permissions p ON p.key = 'bookings.view'
WHERE r.name = 'self_service'
ON CONFLICT (role_id, permission_id) DO NOTHING;
