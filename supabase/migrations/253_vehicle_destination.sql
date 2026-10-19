-- ============================================================================
-- 253 — Vehicles: where the vehicle is going
-- ============================================================================
-- Every new vehicle booking must say where they plan to drive (required on the
-- Hub and public request forms). Nullable so older bookings stay valid.
--
-- Idempotent so it can be re-run from the SQL editor.
-- ----------------------------------------------------------------------------

ALTER TABLE public.vehicle_bookings
  ADD COLUMN IF NOT EXISTS destination text;
