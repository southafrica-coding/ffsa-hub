-- ============================================================
-- FFSA Hub — Migration 162: Restrict Space Bookings to leaders
-- ------------------------------------------------------------
-- Space Bookings (rooms/offices — the `bookings` module) used to be visible
-- to every staff member because migration 115 granted `bookings.view` to the
-- universal `self_service` floor role. It should instead be limited to
-- ministry leaders and the booking-admin roles.
--
-- Nav visibility, page guards (requireModuleAccess("bookings")) and RLS
-- (has_bookings_access()) all key off holding ANY bookings.* permission, so
-- removing this single universal grant does the whole job:
--   - ministry_leader keeps access via bookings.request (migration 131)
--   - booking_manager (view/approve/manage) and leadership_team (request) keep access
--   - super_admin / admin keep access via the is_admin() bypass
--   - regular staff (self_service only) lose Space Booking entirely
--
-- Vehicles are untouched: self_service keeps vehicles.view / vehicles.request.
-- Idempotent: re-running deletes nothing once the row is gone.
-- ============================================================

DELETE FROM public.role_permissions rp
USING public.roles r, public.permissions p
WHERE rp.role_id = r.id
  AND rp.permission_id = p.id
  AND r.name = 'self_service'
  AND p.key = 'bookings.view';
