-- 197_vehicle_inspection_questions.sql
-- Bring the in-Hub Collect / Return inspections up to the full question set of
-- the two Google Forms they replace ("Base Vehicle | Sign Out" / "Sign In"),
-- and add the send-once stamps for the scheduled form-reminder emails.

-- ── 1. The questions the Google Forms asked and the Hub form did not ────────
ALTER TABLE public.vehicle_inspections
  -- Both forms: "All drivers responsible for driving the vehicle is present
  -- for the completion of this form."
  ADD COLUMN IF NOT EXISTS all_drivers_present boolean,
  -- Sign Out: "What are you using it for?" (prefilled from the booking purpose)
  ADD COLUMN IF NOT EXISTS usage_purpose text,
  -- Sign Out: "Do you have a valid Driver License for SA?"
  ADD COLUMN IF NOT EXISTS sa_license_confirmed boolean,
  -- Sign In: "Check in date"
  ADD COLUMN IF NOT EXISTS checkin_date date,
  -- Sign In: "I have communicated truthfully and am not withholding anything"
  ADD COLUMN IF NOT EXISTS communicated_truthfully boolean,
  -- Sign In: "I give permission for FFSA to do a full vehicle inspection"
  ADD COLUMN IF NOT EXISTS inspection_permission boolean;

-- ── 2. Two new attachment kinds on the return form ─────────────────────────
-- Sign In asks for a carwash receipt and a photo of the fuel gauge. Same
-- private bucket, same RLS — only the CHECK needs widening.
ALTER TABLE public.vehicle_inspection_files
  DROP CONSTRAINT IF EXISTS vehicle_inspection_files_kind_check;

ALTER TABLE public.vehicle_inspection_files
  ADD CONSTRAINT vehicle_inspection_files_kind_check
  CHECK (kind IN ('damage_photo', 'license', 'carwash_receipt', 'fuel_gauge'));

-- ── 3. Send-once stamps for the scheduled reminder emails ──────────────────
-- The requester gets the sign-out form at 00:00 on the collection day and the
-- sign-in form at 00:00 on the return day. These columns are what stops the
-- daily cron re-sending, mirroring reference_requests.reminder_sent_at.
ALTER TABLE public.vehicle_bookings
  ADD COLUMN IF NOT EXISTS collection_email_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS return_email_sent_at timestamptz;

COMMENT ON COLUMN public.vehicle_bookings.collection_email_sent_at IS
  'Set once the collection-day "sign out form" email goes out. NULL = still due.';
COMMENT ON COLUMN public.vehicle_bookings.return_email_sent_at IS
  'Set once the return-day "sign in form" email goes out. NULL = still due.';
