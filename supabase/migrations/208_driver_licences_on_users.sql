-- 208_driver_licences_on_users.sql
--
-- Drivers become PEOPLE, not free text.
--
-- Until now every vehicle booking re-typed its drivers and re-uploaded the
-- same licence photo, and `driving_test_status` — the thing that actually
-- gates approval — reset to nothing on every new request. A driver who
-- passed the base driving test last month was still "first time" today.
--
-- This moves the licence and the driving-test result onto the person
-- (public.users), links driver rows back to that person, and lets the booking
-- form fill itself from a profile. Free-text drivers stay supported: a
-- visiting team's driver has no Hub account, and the public request form
-- (see vehicle_request_links below) has no authenticated user at all.
--
-- Licence files live in the SAME private 'vehicle-inspections' bucket created
-- in 104, under user-licenses/<user_id>/… — signed URLs on read, no new
-- bucket and no storage policy (the bucket is private and every read is
-- brokered by an API route that checks vehicle permissions).

-- ────────────────────────────────────────────────────────────
-- 1. LICENCE + DRIVING TEST ON THE PERSON
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS drivers_licence_number      text,
  ADD COLUMN IF NOT EXISTS licence_country             text,   -- ISO-2
  ADD COLUMN IF NOT EXISTS licence_code                text,   -- B, EB, C1, …
  ADD COLUMN IF NOT EXISTS licence_expiry_date         date,
  ADD COLUMN IF NOT EXISTS licence_file_url            text,
  ADD COLUMN IF NOT EXISTS licence_file_name           text,
  ADD COLUMN IF NOT EXISTS licence_uploaded_at         timestamptz,
  ADD COLUMN IF NOT EXISTS licence_uploaded_by         uuid
                            REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS base_driving_test_status    text NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS base_driving_test_passed_at timestamptz,
  ADD COLUMN IF NOT EXISTS base_driving_test_note      text;

-- Added separately: ADD COLUMN … CHECK is not IF NOT EXISTS-safe on re-run.
ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_base_driving_test_status_check;
ALTER TABLE public.users
  ADD CONSTRAINT users_base_driving_test_status_check
  CHECK (base_driving_test_status IN ('not_required', 'pending', 'passed', 'failed'));

COMMENT ON COLUMN public.users.licence_file_url IS
  'Object path in the private vehicle-inspections bucket (user-licenses/<user_id>/…). Not a public URL.';
COMMENT ON COLUMN public.users.base_driving_test_status IS
  'FFSA base-vehicle driving test. Persists on the person: passing once clears every future booking.';

-- ────────────────────────────────────────────────────────────
-- 2. DRIVER ROWS LINK BACK TO THE PERSON
-- ────────────────────────────────────────────────────────────
--
-- user_id is nullable on purpose — outsiders and public requests have no Hub
-- account and keep using name/phone/license_file_url as before.
--
-- The licence snapshot columns freeze what was true AT REQUEST TIME. Without
-- them, a driver renewing their licence would silently rewrite the record of
-- every past booking, and an expired-at-the-time booking would look compliant
-- in hindsight.

ALTER TABLE public.vehicle_booking_drivers
  ADD COLUMN IF NOT EXISTS user_id                  uuid
                            REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS licence_expiry_snapshot  date,
  ADD COLUMN IF NOT EXISTS licence_number_snapshot  text;

CREATE INDEX IF NOT EXISTS idx_vbd_user ON public.vehicle_booking_drivers (user_id);

COMMENT ON COLUMN public.vehicle_booking_drivers.user_id IS
  'The Hub user this driver is. NULL for outsiders / public requests, which keep their own name, phone and licence upload.';
COMMENT ON COLUMN public.vehicle_booking_drivers.licence_expiry_snapshot IS
  'Licence expiry as it stood when the request was made — so a later renewal does not rewrite history.';

-- ────────────────────────────────────────────────────────────
-- 3. PUBLIC REQUEST LINK (outsiders)
-- ────────────────────────────────────────────────────────────
--
-- One standing, rotatable token. Admins copy the /vr/<token> URL to anyone
-- who needs a vehicle but has no Hub account; rotating the token invalidates
-- every copy that is already out there at once.

CREATE TABLE IF NOT EXISTS public.vehicle_request_links (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token       text NOT NULL UNIQUE,
  is_active   boolean NOT NULL DEFAULT true,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  rotated_at  timestamptz
);

ALTER TABLE public.vehicle_request_links ENABLE ROW LEVEL SECURITY;

-- No anon policy: the public form resolves its token through an API route on
-- the service-role client, so the table is never readable from the browser.
-- Token guessing is the only attack surface, and the token is 24 random bytes.
DROP POLICY IF EXISTS "Vehicle managers manage request links"
  ON public.vehicle_request_links;
CREATE POLICY "Vehicle managers manage request links"
  ON public.vehicle_request_links FOR ALL
  USING (
    public.is_admin()
    OR public.has_permission('vehicles.approve')
    OR public.has_permission('vehicles.manage')
  )
  WITH CHECK (
    public.is_admin()
    OR public.has_permission('vehicles.approve')
    OR public.has_permission('vehicles.manage')
  );

-- Where a booking came from. Public requests are reviewed in the same queue
-- but flagged, because nobody vouched for the requester's identity.
ALTER TABLE public.vehicle_bookings
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'internal';

ALTER TABLE public.vehicle_bookings
  DROP CONSTRAINT IF EXISTS vehicle_bookings_source_check;
ALTER TABLE public.vehicle_bookings
  ADD CONSTRAINT vehicle_bookings_source_check
  CHECK (source IN ('internal', 'public'));
