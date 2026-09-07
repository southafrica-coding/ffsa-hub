-- 209_licence_gate.sql
--
-- Every user declares their driver's licence on next login.
--
-- 208 put the licence on the person but left filling it in optional, on the
-- reasoning that most staff never drive a base vehicle. The call has since
-- been made to collect it from everyone up front, so this adds the gate and
-- the fields an INTERNATIONAL licence needs — 208's shape assumed a South
-- African card.
--
-- Three kinds, because "everyone must answer" and "everyone must hold a
-- licence" are different things:
--
--   'sa'            — South African licence.
--   'international' — issued anywhere else. Needs its issuing country, and
--                     may carry an International Driving Permit, which is
--                     what makes it usable on SA roads.
--   'none'          — declares they don't hold one. Still a complete answer,
--                     so the gate lifts; they simply can't be added as a
--                     driver. Without this a staff member with no licence
--                     could never get into the Hub again.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS licence_kind                  text,
  -- Some countries issue licences with no printed expiry. Without this flag
  -- those holders can't satisfy a required expiry date and would be stuck
  -- inventing one.
  ADD COLUMN IF NOT EXISTS licence_no_expiry             boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_international_permit      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS international_permit_expiry   date,
  -- When they answered the gate. NULL means "never asked" and is what the
  -- gate tests, so it must NOT be backfilled for existing users — they are
  -- exactly who we want to prompt.
  ADD COLUMN IF NOT EXISTS licence_declared_at           timestamptz;

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_licence_kind_check;
ALTER TABLE public.users
  ADD CONSTRAINT users_licence_kind_check
  CHECK (licence_kind IS NULL OR licence_kind IN ('sa', 'international', 'none'));

COMMENT ON COLUMN public.users.licence_kind IS
  'sa | international | none. NULL = has never answered the licence gate.';
COMMENT ON COLUMN public.users.licence_declared_at IS
  'When the user answered the licence gate. NULL blocks the Hub on next login — never backfill.';
COMMENT ON COLUMN public.users.licence_no_expiry IS
  'Their licence carries no printed expiry date (true of some non-SA licences).';

-- Anyone who already filled in a licence under 208 has plainly answered the
-- question, so they are not re-prompted. Country decides the kind: 208 stored
-- it as an ISO-2 code.
UPDATE public.users
SET
  licence_kind = CASE
                   WHEN licence_country IS NULL OR upper(licence_country) = 'ZA'
                     THEN 'sa'
                   ELSE 'international'
                 END,
  licence_declared_at = COALESCE(licence_uploaded_at, now())
WHERE licence_declared_at IS NULL
  AND drivers_licence_number IS NOT NULL
  AND licence_expiry_date IS NOT NULL;
