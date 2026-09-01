-- 196_vehicle_driver_licenses.sql
-- Per-driver licence uploads on vehicle bookings.
--
-- vehicle_booking_drivers.license_file_url has existed since 103 but was never
-- written. It now holds the STORAGE OBJECT PATH inside the existing private
-- 'vehicle-inspections' bucket (created in 104) — signed URLs are minted on
-- read, exactly like vehicle_inspection_files. No new bucket, no new RLS: the
-- existing driver policies (admin / vehicles.approve / vehicles.manage / the
-- parent booking's requester) already cover who may attach a licence.

ALTER TABLE public.vehicle_booking_drivers
  ADD COLUMN IF NOT EXISTS license_file_name text,
  ADD COLUMN IF NOT EXISTS license_uploaded_at timestamptz,
  ADD COLUMN IF NOT EXISTS license_uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.vehicle_booking_drivers.license_file_url IS
  'Object path in the private vehicle-inspections bucket (licenses/<booking_id>/<driver_id>/…). Not a public URL.';
