-- ============================================================================
-- 242 — Passport page photos (profile + public-request drivers)
-- ============================================================================
-- Every driver on a vehicle booking must now have a passport page photo and a
-- driver's licence photo on file. Staff keep both on their Hub profile (the
-- licence already lives there — migration 196 era); a booking pulls them from
-- each driver's profile instead of asking again. Public-form drivers aren't
-- Hub users, so theirs are attached to the booking's driver row.
--
-- Files live in the private 'vehicle-inspections' bucket (from 104), read back
-- only through signed URLs:
--   user-passports/<user_id>/…              — on the profile
--   passports/<booking_id>/<driver_id>/…   — public-form drivers
--
-- Idempotent so it can be re-run from the SQL editor.
-- ----------------------------------------------------------------------------

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS passport_file_url     text,
  ADD COLUMN IF NOT EXISTS passport_file_name    text,
  ADD COLUMN IF NOT EXISTS passport_uploaded_at  timestamptz;

COMMENT ON COLUMN public.users.passport_file_url IS
  'Object path in the private vehicle-inspections bucket (user-passports/<user_id>/…). Not a public URL.';

ALTER TABLE public.vehicle_booking_drivers
  ADD COLUMN IF NOT EXISTS passport_file_url    text,
  ADD COLUMN IF NOT EXISTS passport_file_name   text,
  ADD COLUMN IF NOT EXISTS passport_uploaded_at timestamptz;
