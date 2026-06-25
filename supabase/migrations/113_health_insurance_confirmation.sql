-- ============================================================
-- 113_health_insurance_confirmation.sql
-- ============================================================
-- SA medical schemes don't lapse on a fixed date the member tracks, so the
-- old health_insurance_expiry_date model asked for a date that often does
-- not exist. Replace it with a periodic self-confirmation: every 6 months
-- each user attests their cover is still current. Validity is derived from
-- health_insurance_confirmed_at (see src/lib/users/profile-fields.ts).
--
-- The expiry_date column is intentionally LEFT IN PLACE (deprecated) so this
-- migration is non-destructive; a later cleanup can drop it once nothing
-- reads it.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS health_insurance_confirmed_at timestamptz;

COMMENT ON COLUMN public.users.health_insurance_confirmed_at IS
  'When the user last confirmed their health insurance is current. Re-confirmation falls due every 6 months; the Hub gate blocks until then. Replaces the deprecated health_insurance_expiry_date.';

-- Backfill: anyone with a real provider already on file is treated as
-- confirmed now, so nobody is prompted on day one — they come due naturally
-- over the following 6 months. Users with no provider (or a legacy "none")
-- are left NULL; the gate makes them pick a real provider first.
UPDATE public.users
   SET health_insurance_confirmed_at = now()
 WHERE health_insurance_confirmed_at IS NULL
   AND health_insurance_provider IS NOT NULL
   AND btrim(health_insurance_provider) <> ''
   AND lower(btrim(health_insurance_provider)) <> 'none';
